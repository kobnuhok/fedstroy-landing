// Yandex Cloud Function (HTTP Trigger) для приёма заявок ООО «ФЕДСТРОЙ».
// Поддерживает CORS для GitHub Pages, multipart/form-data (включая вложения), валидацию и отправку в Telegram + Email.

const crypto = require('crypto');
const https = require('https');
const path = require('path');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_) {}

const ALLOWED_ORIGINS = [
  /^https:\/\/kobnuhok\.github\.io$/,
  /^https:\/\/fedstroy-landing\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

const ALLOWED_EXTS = new Set(['.dwg', '.pdf', '.zip', '.rar', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg']);
const MAX_EMAIL_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const TELEGRAM_TIMEOUT_MS = 8000;
const EMAIL_TIMEOUT_MS = 6000;
const TELEGRAM_API_HOST = (process.env.TELEGRAM_API_HOST || 'api.telegram.org')
  .replace(/^https?:\/\//i, '')
  .replace(/\/.*$/, '')
  .trim() || 'api.telegram.org';
const TELEGRAM_RELAY_SECRET = process.env.TELEGRAM_RELAY_SECRET || '';
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const SHEETS_TIMEOUT_MS = 5000;

function getCorsHeaders(origin) {
  const allowOrigin = (origin && ALLOWED_ORIGINS.some(re => re.test(origin)))
    ? origin
    : 'https://kobnuhok.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(statusCode, payload, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(origin)
    },
    body: JSON.stringify(payload)
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseMultipart(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) {
    throw new Error('Некорректный заголовок Content-Type: отсутствует boundary');
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;

  let pos = bodyBuffer.indexOf(delimiter);
  while (pos !== -1) {
    const start = pos + delimiter.length;
    if (bodyBuffer[start] === 0x2D && bodyBuffer[start + 1] === 0x2D) break; // -- closing boundary

    const nextPos = bodyBuffer.indexOf(delimiter, start);
    if (nextPos === -1) break;

    // Skip leading \r\n
    const partStart = (bodyBuffer[start] === 0x0D && bodyBuffer[start + 1] === 0x0A) ? start + 2 : start;
    // Strip trailing \r\n before next boundary
    let partEnd = nextPos;
    if (partEnd >= 2 && bodyBuffer[partEnd - 2] === 0x0D && bodyBuffer[partEnd - 1] === 0x0A) {
      partEnd -= 2;
    }

    const headerEnd = bodyBuffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd !== -1 && headerEnd < partEnd) {
      const headersRaw = bodyBuffer.subarray(partStart, headerEnd).toString('utf8');
      const data = bodyBuffer.subarray(headerEnd + 4, partEnd);
      const nameMatch = headersRaw.match(/name="([^"]+)"/i);
      const filenameMatch = headersRaw.match(/filename="([^"]*)"/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch) {
          const originalName = filenameMatch[1];
          if (originalName && data.length > 0) {
            file = { originalName, buffer: data, size: data.length };
          } else if (originalName && originalName !== 'blob' && data.length === 0) {
            file = { originalName, buffer: data, size: 0 };
          }
        } else {
          fields[fieldName] = data.toString('utf8');
        }
      }
    }

    pos = nextPos;
  }

  return { fields, file };
}

function validateFileBuffer(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return 'Недопустимый формат файла.';
  }
  if (buffer.length === 0) {
    return 'Прикрепленный файл пуст (0 байт).';
  }
  if (buffer.length >= 2) {
    const isPE = buffer[0] === 0x4D && buffer[1] === 0x5A;
    const isELF = buffer.length >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46;
    const isShebang = buffer[0] === 0x23 && buffer[1] === 0x21;
    if (isPE || isELF || isShebang) {
      return 'Обнаружен исполняемый файл или скрипт под видом проектной документации. Загрузка отклонена.';
    }
  }
  if (ext === '.pdf' && (buffer.length < 4 || buffer.subarray(0, 4).toString('ascii') !== '%PDF')) {
    return 'Файл с расширением .pdf поврежден или не содержит заголовка %PDF.';
  }
  if (ext === '.png' && (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47)) {
    return 'Файл с расширением .png поврежден.';
  }
  if ((ext === '.jpg' || ext === '.jpeg') && (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF)) {
    return 'Файл с расширением .jpg/.jpeg поврежден.';
  }
  if (ext === '.zip' && (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B)) {
    return 'Файл с расширением .zip поврежден.';
  }
  return null;
}

function validatePayload(fields) {
  const { name, phone, agreement, service, area, building, comment, source } = fields || {};
  const isAgreed = agreement === 'on' || agreement === 'true' || agreement === true || agreement === '1';
  if (!isAgreed) return 'Необходимо подтвердить согласие на обработку персональных данных.';

  const cleanName = String(name || '').trim();
  if (!cleanName) return 'Пожалуйста, укажите имя контактного лица.';
  if (cleanName.length > 100) return 'Имя контактного лица не должно превышать 100 символов.';

  const phoneClean = (phone || '').replace(/\D/g, '');
  const isValidPhone = (phoneClean.length === 11 && (phoneClean.startsWith('7') || phoneClean.startsWith('8'))) ||
                       (phoneClean.length === 10 && phoneClean.startsWith('9'));
  if (!isValidPhone || phoneClean.length > 32 || String(phone || '').length > 32) {
    return 'Пожалуйста, укажите корректный контактный номер телефона РФ (10–11 цифр).';
  }

  if (service && String(service).length > 200) return 'Поле услуги не должно превышать 200 символов.';
  if (building && String(building).length > 200) return 'Поле типа объекта не должно превышать 200 символов.';
  if (area && String(area).trim().length > 32) return 'Поле площади не должно превышать 32 символов.';
  if (comment && String(comment).length > 5000) return 'Комментарий к проекту не должен превышать 5000 символов.';
  if (source && String(source).length > 250) return 'Поле источника не должно превышать 250 символов.';
  return null;
}

function requestTelegram(apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'User-Agent': 'fedstroy-yc-relay/1.0',
      ...headers
    };
    if (TELEGRAM_RELAY_SECRET) {
      reqHeaders['X-Relay-Secret'] = TELEGRAM_RELAY_SECRET;
    }
    const req = https.request({
      host: TELEGRAM_API_HOST,
      path: apiPath,
      method: 'POST',
      headers: reqHeaders,
      timeout: TELEGRAM_TIMEOUT_MS
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(raw) });
        } catch {
          resolve({ ok: false, data: { description: raw } });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function sendTelegram(lead, file) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: true, mocked: true };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: 'Telegram env missing' };

  const text = [
    `<b>🏗 Новая заявка с сайта ООО «ФЕДСТРОЙ»</b>`,
    `<b>📋 Номер:</b> <code>${lead.leadId}</code>`,
    `<b>👤 Клиент:</b> ${escapeHtml(lead.name)}`,
    `<b>📞 Телефон:</b> ${escapeHtml(lead.phone)}`,
    lead.service ? `<b>⚙️ Услуга:</b> ${escapeHtml(lead.service)}` : null,
    lead.area ? `<b>📐 Площадь:</b> ${escapeHtml(lead.area)} м²` : null,
    lead.building ? `<b>🏢 Объект:</b> ${escapeHtml(lead.building)}` : null,
    lead.source ? `<b>📌 Источник:</b> ${escapeHtml(lead.source)}` : null,
    lead.comment ? `<b>💬 Комментарий:</b> ${escapeHtml(lead.comment)}` : null,
    file ? `<b>📎 Файл ТЗ:</b> ${escapeHtml(file.originalName)} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : null
  ].filter(Boolean).join('\n');

  const msgBody = JSON.stringify({ chat_id: String(chatId).trim(), text, parse_mode: 'HTML' });
  const msgRes = await requestTelegram(`/bot${token}/sendMessage`, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(msgBody)
  }, msgBody);

  if (file && file.buffer && msgRes.ok) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const safeName = file.originalName.replace(/[\r\n"]/g, '_');
    const docBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${String(chatId).trim()}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nТЗ к заявке ${lead.leadId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    await requestTelegram(`/bot${token}/sendDocument`, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': docBody.length
    }, docBody);
  }

  return { sent: !!(msgRes.ok && msgRes.data?.ok) };
}

async function sendEmail(lead, file) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: true, mocked: true };
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.EMAIL_TO || 'kobnuhok@yandex.ru';
  if (!nodemailer || !user || !pass) return { sent: false, reason: 'SMTP not configured' };

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.yandex.ru',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass },
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS
  });

  const safeName = escapeHtml(lead.name) || 'Не указано';
  const safePhone = escapeHtml(lead.phone);
  const safeService = escapeHtml(lead.service) || '—';
  const safeArea = lead.area ? `${escapeHtml(lead.area)} м²` : '—';
  const safeBuilding = escapeHtml(lead.building) || '—';
  const safeSource = escapeHtml(lead.source) || 'Форма на сайте';
  const safeComment = escapeHtml(lead.comment) || '—';
  const mskTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const fileLine = file ? `${escapeHtml(file.originalName)} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : 'Нет';

  const mailOptions = {
    from: `"ООО «ФЕДСТРОЙ»" <${user}>`,
    to,
    replyTo: user,
    subject: `🏗 Новая заявка [${lead.leadId}]: ${lead.name || lead.phone}`,
    text: [
      `Заявка: ${lead.leadId}`,
      `Дата: ${mskTime} (МСК)`,
      `Клиент: ${lead.name || 'Не указано'}`,
      `Телефон: ${lead.phone}`,
      `Услуга: ${lead.service || '—'}`,
      `Площадь: ${lead.area ? lead.area + ' м²' : '—'}`,
      `Тип объекта: ${lead.building || '—'}`,
      `Комментарий: ${lead.comment || '—'}`,
      `Источник: ${lead.source || 'Форма на сайте'}`,
      `Файл ТЗ: ${file ? file.originalName : 'Нет'}`
    ].join('\n'),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #0f172a; padding: 20px 24px; color: #ffffff;">
          <h2 style="margin: 0 0 6px 0; font-size: 18px;">🏗 Новая заявка с сайта ООО «ФЕДСТРОЙ»</h2>
          <p style="margin: 0; color: #94a3b8; font-size: 13px;">Номер: <strong style="color: #38bdf8;">${lead.leadId}</strong> • ${mskTime} (МСК)</p>
        </div>
        <div style="padding: 20px 24px; background: #ffffff;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b; width: 35%;"><strong>Клиент:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safeName}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Телефон:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safePhone}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Услуга:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safeService}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Площадь:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safeArea}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Тип объекта:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safeBuilding}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Источник:</strong></td><td style="padding: 8px 0; color: #0f172a;">${safeSource}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;"><strong>Комментарий:</strong></td><td style="padding: 8px 0; color: #0f172a; white-space: pre-wrap;">${safeComment}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b;"><strong>Файл ТЗ:</strong></td><td style="padding: 8px 0; color: #0f172a;">${fileLine}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `
  };

  if (file && file.buffer && file.size <= MAX_EMAIL_ATTACHMENT_SIZE) {
    mailOptions.attachments = [{ filename: file.originalName, content: file.buffer }];
  }

  const info = await Promise.race([
    transporter.sendMail(mailOptions),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), EMAIL_TIMEOUT_MS))
  ]);
  return { sent: true, messageId: info.messageId };
}

function saveToGoogleSheet(lead, file) {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve({ saved: true, mocked: true });
  }
  if (!GOOGLE_SHEETS_WEBHOOK_URL) {
    return Promise.resolve({ saved: false, reason: 'GOOGLE_SHEETS_WEBHOOK_URL not set' });
  }

  return new Promise((resolve, reject) => {
    try {
      const target = new URL(GOOGLE_SHEETS_WEBHOOK_URL);
      const payload = JSON.stringify({
        createdAtMsk: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        leadId: lead.leadId,
        name: lead.name,
        phone: lead.phone,
        service: lead.service,
        area: lead.area,
        building: lead.building,
        comment: lead.comment,
        source: lead.source,
        fileInfo: file ? `${file.originalName} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : ''
      });

      const req = https.request({
        host: target.host,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: SHEETS_TIMEOUT_MS
      }, (res) => {
        res.resume();
        resolve({ saved: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode });
      });
      req.on('timeout', () => req.destroy(new Error('Google Sheets timeout')));
      req.on('error', reject);
      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || '';
  const method = (event.httpMethod || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: getCorsHeaders(origin), body: '' };
  }
  if (method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method Not Allowed' }, origin);
  }

  try {
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    let fields = {};
    let file = null;

    if (contentType.includes('multipart/form-data')) {
      ({ fields, file } = parseMultipart(rawBody, contentType));
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      fields = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
    } else if (contentType.includes('application/json')) {
      fields = JSON.parse(rawBody.toString('utf8') || '{}');
    } else {
      fields = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
    }

    const validationError = validatePayload(fields);
    if (validationError) {
      return jsonResponse(400, { success: false, error: validationError }, origin);
    }

    if (file) {
      const fileError = validateFileBuffer(file.buffer, file.originalName);
      if (fileError) {
        return jsonResponse(400, { success: false, error: fileError }, origin);
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const leadId = `ФС-${dateStr}-${crypto.randomBytes(4).toString('hex')}`;
    const lead = {
      leadId,
      name: String(fields.name || '').trim(),
      phone: String(fields.phone || '').trim(),
      service: String(fields.service || '').trim(),
      area: String(fields.area || '').trim(),
      building: String(fields.building || '').trim(),
      comment: String(fields.comment || '').trim(),
      source: String(fields.source || 'GitHub Pages').trim()
    };

    const [tgRes, emRes, sheetRes] = await Promise.allSettled([
      sendTelegram(lead, file),
      sendEmail(lead, file),
      saveToGoogleSheet(lead, file)
    ]);

    const tgVal = tgRes.status === 'fulfilled' ? tgRes.value : { sent: false, error: tgRes.reason?.message };
    const emVal = emRes.status === 'fulfilled' ? emRes.value : { sent: false, error: emRes.reason?.message };
    const sheetVal = sheetRes.status === 'fulfilled' ? sheetRes.value : { saved: false, error: sheetRes.reason?.message };

    if (!tgVal.sent && !emVal.sent && !sheetVal.saved && process.env.NODE_ENV !== 'test') {
      console.error('[yc:lead:delivery-failed]', { tgVal, emVal, sheetVal });
      return jsonResponse(502, {
        success: false,
        error: `Не удалось доставить уведомление (${tgVal.error || tgVal.reason || emVal.error || sheetVal.error || 'таймаут'}).`
      }, origin);
    }

    return jsonResponse(200, {
      success: true,
      leadId,
      message: 'Заявка зарегистрирована. Мы свяжемся с вами в рабочее время.',
      ...(process.env.NODE_ENV === 'test' ? {
        telegram: tgVal,
        email: emVal,
        sheet: sheetVal
      } : {})
    }, origin);
  } catch (err) {
    console.error('[yc:lead:error]', err);
    return jsonResponse(500, {
      success: false,
      error: 'Ошибка обработки заявки. Пожалуйста, позвоните по номеру 8 (800) 700-02-23.'
    }, origin);
  }
};
