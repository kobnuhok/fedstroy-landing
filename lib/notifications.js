// Notification delivery (Telegram & SMTP Email) and concurrency queue.

const fs = require('fs');
const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

const isVercel = !!process.env.VERCEL;

const MAX_NOTIFICATION_ATTEMPTS = 3;
const MAX_CONCURRENT_NOTIFICATIONS = 2;
const MAX_NOTIFICATION_QUEUE = 50;
const TELEGRAM_REQUEST_TIMEOUT_MS = 15000;
const MAX_EMAIL_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const EMAIL_TO = process.env.EMAIL_TO || 'kobnuhok@yandex.ru';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.yandex.ru';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

let activeNotificationJobs = 0;
const notificationQueue = [];
let mailTransporter = null;

function runWithNotificationQueue(taskFn) {
  if (isVercel) {
    return Promise.resolve().then(() => taskFn());
  }

  return new Promise((resolve, reject) => {
    if (activeNotificationJobs >= MAX_CONCURRENT_NOTIFICATIONS && notificationQueue.length >= MAX_NOTIFICATION_QUEUE) {
      const err = new Error(`Очередь уведомлений переполнена (${MAX_NOTIFICATION_QUEUE} ожидающих задач)`);
      err.code = 'QUEUE_OVERFLOW';
      return reject(err);
    }

    const execute = () => {
      activeNotificationJobs++;
      Promise.resolve()
        .then(() => taskFn())
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeNotificationJobs--;
          if (notificationQueue.length > 0) {
            const next = notificationQueue.shift();
            next();
          }
        });
    };

    if (activeNotificationJobs < MAX_CONCURRENT_NOTIFICATIONS) {
      execute();
    } else {
      notificationQueue.push(execute);
    }
  });
}

function getMailTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return mailTransporter;
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

function requestTelegram(apiPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const sendHttps = (extraOpts, label) => {
      const req = https.request({
        host: 'api.telegram.org',
        path: apiPath,
        method,
        headers,
        timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
        ...extraOpts
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
      req.on('timeout', () => {
        req.destroy(new Error(`Telegram request timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms (${label})`));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    };

    if (process.env.VERCEL) {
      sendHttps({}, 'Vercel direct');
      return;
    }

    const proxyReq = http.request({
      host: '127.0.0.1',
      port: 10808,
      method: 'CONNECT',
      path: 'api.telegram.org:443',
      timeout: 1500
    });

    let finished = false;
    function fallbackDirect() {
      if (finished) return;
      finished = true;
      sendHttps({}, 'Fallback direct');
    }

    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode === 200) {
        finished = true;
        sendHttps({ socket, agent: false }, 'Proxy socket');
      } else {
        fallbackDirect();
      }
    });

    proxyReq.on('error', fallbackDirect);
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      fallbackDirect();
    });
    proxyReq.end();
  });
}

async function sendToTelegram(lead, file, options = {}) {
  const fileExpected = !!lead.file;
  const hasPhysicalFile = !!(file && file.path && fs.existsSync(file.path));
  const fileMissing = fileExpected && !hasPhysicalFile;
  const onlyDocument = !!options.onlyDocument;
  const requestFn = options.requestTelegram || requestTelegram;

  if (process.env.NODE_ENV === 'test' && !options.useLiveClient) {
    const docSent = fileExpected ? hasPhysicalFile : null;
    const isFullyDelivered = fileExpected ? hasPhysicalFile : true;
    return {
      sent: onlyDocument ? (docSent ?? true) : true,
      mocked: true,
      messageSent: !onlyDocument,
      messageSkipped: onlyDocument,
      messageId: lead.notifications?.telegramMessageId || 1001,
      documentSent: docSent,
      fullyDelivered: isFullyDelivered,
      fileMissing,
      ...(fileMissing ? { documentError: 'Вложение ожидалось, но файл отсутствует на сервере' } : {})
    };
  }

  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegram:skip] Токен или Chat ID не заданы в process.env — отправка в Telegram пропущена');
    return {
      sent: false,
      messageSent: false,
      documentSent: fileExpected ? false : null,
      fullyDelivered: false,
      fileMissing,
      reason: 'Токен или Chat ID не заданы в переменных окружения'
    };
  }

  let targetChatId = String(chatId).trim();
  let messageId = lead.notifications?.telegramMessageId || null;

  if (!onlyDocument) {
    console.log(`[telegram:start] Отправка уведомления для заявки ${lead.leadId} в чат ${chatId}...`);

    try {
      const text = [
        `<b>🏗 Новая заявка с сайта ООО «ФЕДСТРОЙ»</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `<b>📋 Номер расчетного листа:</b> <code>${lead.leadId}</code>`,
        `<b>👤 Клиент:</b> ${escapeHtml(lead.name) || 'Не указано'}`,
        `<b>📞 Телефон:</b> ${escapeHtml(lead.phone)}`,
        lead.service ? `<b>⚙️ Услуга:</b> ${escapeHtml(lead.service)}` : null,
        lead.area ? `<b>📐 Площадь:</b> ${escapeHtml(lead.area)} м²` : null,
        lead.building ? `<b>🏢 Тип объекта:</b> ${escapeHtml(lead.building)}` : null,
        lead.source ? `<b>📌 Источник:</b> ${escapeHtml(lead.source)}` : null,
        lead.comment ? `<b>💬 Комментарий:</b> ${escapeHtml(lead.comment)}` : null,
        lead.file ? `<b>📎 Прикреплен файл ТЗ:</b> ${escapeHtml(lead.file.originalName || file?.originalName || 'Файл')} (${(((lead.file.size || file?.size || 0)) / (1024 * 1024)).toFixed(2)} МБ)` : null,
        fileMissing ? `⚠️ <b>Внимание:</b> файл вложения отсутствует на диске сервера (удален или не сохранен)` : null,
        `━━━━━━━━━━━━━━━━━━━━`,
        `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`
      ].filter(Boolean).join('\n');

      const msgBody = JSON.stringify({ chat_id: targetChatId, text, parse_mode: 'HTML' });
      let msgRes = await requestFn(`/bot${token}/sendMessage`, 'POST', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(msgBody)
      }, msgBody);

      if ((!msgRes.ok || !msgRes.data?.ok) && msgRes.data?.description?.includes('chat not found') && !targetChatId.startsWith('-')) {
        const groupChatId = `-${targetChatId}`;
        console.log(`[telegram:fallback] Попытка отправки в группу: ${groupChatId}`);
        const retryBody = JSON.stringify({ chat_id: groupChatId, text, parse_mode: 'HTML' });
        const retryRes = await requestFn(`/bot${token}/sendMessage`, 'POST', {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(retryBody)
        }, retryBody);
        if (retryRes.ok && retryRes.data?.ok) {
          msgRes = retryRes;
          targetChatId = groupChatId;
        }
      }

      if (!msgRes.ok || !msgRes.data?.ok) {
        console.error('[telegram:notify:error] Ошибка Telegram API:', msgRes.data?.description);
        return {
          sent: false,
          messageSent: false,
          documentSent: fileExpected ? false : null,
          fullyDelivered: false,
          fileMissing,
          error: msgRes.data?.description || 'Ошибка Telegram API'
        };
      }

      messageId = msgRes.data.result?.message_id;
      console.log(`[telegram:notify:success] Заявка ${lead.leadId} успешно доставлена в Telegram! (message_id: ${messageId})`);
    } catch (err) {
      console.error('[telegram:notify:error] Сетевая ошибка при отправке в Telegram:', err.message);
      return {
        sent: false,
        messageSent: false,
        documentSent: fileExpected ? false : null,
        fullyDelivered: false,
        fileMissing,
        error: err.message
      };
    }
  } else {
    console.log(`[telegram:document:retry] Заявка ${lead.leadId}: текстовое сообщение уже доставлено (ID: ${messageId}), отправляем только документ`);
  }

  let docSent = false;
  let docError = null;
  if (fileMissing) {
    docError = 'Вложение ожидалось, но файл отсутствует на диске сервера';
    console.warn(`[telegram:document:warn] Заявка ${lead.leadId}: файл ${lead.file?.originalName} отсутствует на диске`);
  } else if (hasPhysicalFile) {
    try {
      const fileData = fs.readFileSync(file.path);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
      const safeOriginalName = (file.originalName || file.filename || 'document.pdf').replace(/[\r\n"]/g, '_');
      const caption = `ТЗ к заявке ${lead.leadId} от ${lead.name || lead.phone}`;

      const formBuffers = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${targetChatId}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeOriginalName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        fileData,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ];
      const docBody = Buffer.concat(formBuffers);

      let docRes = await requestFn(`/bot${token}/sendDocument`, 'POST', {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': docBody.length
      }, docBody);

      if ((!docRes.ok || !docRes.data?.ok) && docRes.data?.description?.includes('chat not found') && !targetChatId.startsWith('-')) {
        const groupChatId = `-${targetChatId}`;
        formBuffers[0] = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${groupChatId}\r\n`);
        const retryDocBody = Buffer.concat(formBuffers);
        docRes = await requestFn(`/bot${token}/sendDocument`, 'POST', {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': retryDocBody.length
        }, retryDocBody);
      }

      if (!docRes.ok || !docRes.data?.ok) {
        docError = docRes.data?.description || 'Не удалось отправить документ в Telegram';
        console.error('[telegram:document:error] Ошибка отправки документа:', docError);
      } else {
        docSent = true;
        console.log(`[telegram:document:success] Файл ${safeOriginalName} успешно доставлен в Telegram!`);
      }
    } catch (docErr) {
      docError = docErr.message;
      console.error('[telegram:document:fatal]', docErr.message);
    }
  }

  const isFullyDelivered = fileExpected ? docSent : true;
  if (fileExpected && !docSent) {
    console.warn(`[telegram:document:warn] Заявка ${lead.leadId}: текстовое сообщение отправлено (ID: ${messageId}), но вложение не доставлено: ${docError}`);
  }

  return {
    sent: onlyDocument ? docSent : true,
    messageSent: !onlyDocument,
    messageSkipped: onlyDocument,
    messageId,
    documentSent: fileExpected ? docSent : null,
    documentError: docError,
    fileMissing,
    fullyDelivered: isFullyDelivered
  };
}

async function sendToEmail(lead, file) {
  const fileExpected = !!lead.file;
  const hasPhysicalFile = !!(file && file.path && fs.existsSync(file.path));
  const fileMissing = fileExpected && !hasPhysicalFile;

  if (process.env.NODE_ENV === 'test') {
    const isAttached = hasPhysicalFile && file.size <= MAX_EMAIL_ATTACHMENT_SIZE;
    return {
      sent: true,
      mocked: true,
      messageId: 'mock-email-msg-id-123',
      recipient: EMAIL_TO,
      attached: isAttached,
      oversized: !!(hasPhysicalFile && file.size > MAX_EMAIL_ATTACHMENT_SIZE),
      fileMissing
    };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    console.log(`[email:skip] SMTP не настроен (SMTP_USER/SMTP_PASS не заданы в .env). Дублирование на ${EMAIL_TO} пропущено, заявка сохранена локально.`);
    return { sent: false, recipient: EMAIL_TO, fileMissing, reason: 'SMTP не настроен (задайте SMTP_USER и SMTP_PASS в .env)' };
  }

  console.log(`[email:start] Отправка дубликата заявки ${lead.leadId} на почту ${EMAIL_TO}...`);

  try {
    const mskTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const safeName = escapeHtml(lead.name) || 'Не указано';
    const safePhone = escapeHtml(lead.phone);
    const safeService = escapeHtml(lead.service) || '—';
    const safeArea = lead.area ? `${escapeHtml(lead.area)} м²` : '—';
    const safeBuilding = escapeHtml(lead.building) || '—';
    const safeSource = escapeHtml(lead.source) || 'Форма на сайте';
    const safeComment = escapeHtml(lead.comment) || '—';

    const hasAttachment = hasPhysicalFile;
    const isOversizedForEmail = hasAttachment && file.size > MAX_EMAIL_ATTACHMENT_SIZE;

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
        <div style="background: #0f172a; padding: 24px; color: #ffffff;">
          <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #ffffff;">🏗 Новая заявка с сайта ООО «ФЕДСТРОЙ»</h2>
          <p style="margin: 0; color: #94a3b8; font-size: 14px;">Номер расчетного листа: <strong style="color: #38bdf8;">${lead.leadId}</strong></p>
        </div>
        <div style="padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Клиент:</strong></td>
                <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${safeName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;"><strong>Телефон:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;"><a href="tel:${lead.phone.replace(/[^+\d]/g, '')}" style="color: #0284c7; text-decoration: none; font-weight: 700;">${safePhone}</a></td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;"><strong>Услуга:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">${safeService}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;"><strong>Площадь:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">${safeArea}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;"><strong>Тип объекта:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">${safeBuilding}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;"><strong>Источник:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">${safeSource}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; vertical-align: top;"><strong>Комментарий:</strong></td>
                <td style="padding: 10px 0; color: #0f172a; white-space: pre-wrap;">${safeComment}</td>
              </tr>
              ${lead.file ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; vertical-align: top;"><strong>Прикреплен файл:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">
                  📎 ${escapeHtml(lead.file.originalName || file?.originalName || 'Файл')} (${(((lead.file.size || file?.size || 0)) / (1024 * 1024)).toFixed(2)} МБ)
                  ${fileMissing ? `
                  <div style="margin-top: 6px; padding: 8px 12px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 6px; font-size: 13px; color: #991b1b; line-height: 1.4;">
                    ⚠️ <strong>Внимание:</strong> файл проекта отсутствует на диске сервера (удален политикой очистки или не сохранен).
                  </div>
                  ` : (isOversizedForEmail ? `
                  <div style="margin-top: 6px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e; line-height: 1.4;">
                    ⚠️ <strong>Вложение не прикреплено к письму:</strong> размер файла превышает лимит почтового шлюза (20 МБ) с учетом MIME-кодирования (жесткий лимит Яндекс Почты — 30 МБ).<br>
                    📁 <strong>Файл превышает лимит email-вложения. Информация о файле сохранена в заявке; передача вложения выполняется отдельным каналом уведомлений.</strong>
                  </div>
                  ` : '')}
                </td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>
        <div style="background: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
          ⏰ Заявка зарегистрирована в системе: ${mskTime} (МСК)<br>
          Отправлено сервером ООО «ФЕДСТРОЙ» на ${EMAIL_TO}
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"ООО «ФЕДСТРОЙ»" <${SMTP_USER}>`,
      to: EMAIL_TO,
      replyTo: SMTP_USER,
      subject: `🏗 Новая заявка [${lead.leadId}]: ${lead.name || lead.phone}`,
      html: htmlBody
    };

    if (hasAttachment && !isOversizedForEmail) {
      mailOptions.attachments = [{
        filename: file.originalName || file.filename || 'attachment.pdf',
        content: fs.readFileSync(file.path)
      }];
    } else if (fileMissing) {
      console.warn(`[email:attachment:missing] Файл ${lead.file?.originalName} отсутствует на диске. Отправка email без вложения.`);
    } else if (isOversizedForEmail) {
      console.log(`[email:attachment:notice] Файл ${file.originalName} (${(file.size / (1024 * 1024)).toFixed(2)} МБ) превышает лимит 20 МБ. Отправка email без вложения.`);
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[email:notify:success] Заявка ${lead.leadId} успешно доставлена на почту ${EMAIL_TO} (ID: ${info.messageId})`);
    return {
      sent: true,
      recipient: EMAIL_TO,
      messageId: info.messageId,
      attached: hasAttachment && !isOversizedForEmail,
      fileMissing
    };
  } catch (err) {
    console.error('[email:notify:error] Ошибка отправки на почту:', err.message);
    return { sent: false, recipient: EMAIL_TO, fileMissing, error: err.message };
  }
}

function shouldRetryTelegram(notif) {
  if (!notif) return false;
  const status = notif.telegram;
  const attempts = notif.attempts?.telegram ?? (status === 'pending' ? 0 : 1);
  return ['pending', 'failed', 'partial'].includes(status) && attempts < MAX_NOTIFICATION_ATTEMPTS;
}

function shouldRetryEmail(notif) {
  if (!notif) return false;
  const status = notif.email;
  const attempts = notif.attempts?.email ?? (status === 'pending' ? 0 : 1);
  return ['pending', 'failed'].includes(status) && attempts < MAX_NOTIFICATION_ATTEMPTS;
}

module.exports = {
  EMAIL_TO,
  SMTP_USER,
  SMTP_PASS,
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_CONCURRENT_NOTIFICATIONS,
  MAX_NOTIFICATION_QUEUE,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  runWithNotificationQueue,
  requestTelegram,
  sendToTelegram,
  sendToEmail,
  shouldRetryTelegram,
  shouldRetryEmail
};
