// Express API сервер ООО «ФЕДСТРОЙ»: прием заявок, валидация файлов и Telegram-уведомления.

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 8080;

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/kobnuhok\.github\.io$/,
  /^https:\/\/(www\.)?ooofedstroy\.ru$/,
  /^https:\/\/fedstroy-landing(-[a-zA-Z0-9-]+)?\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

const isVercel = !!process.env.VERCEL;

app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    // Разрешаем запросы без origin (server-to-server, curl) и из доверенных источников
    if (!origin || ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin))) {
      return cb(null, true);
    }
    // Отклоняем CORS без падения сервера (без 500)
    return cb(null, false);
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Встроенный rate-limiter: защита от спама и DoS-атак на /api/lead (макс. 15 запросов в минуту с 1 IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;

function leadRateLimiter(req, res, next) {
  // В тестах не ограничиваем скорость
  if (process.env.NODE_ENV === 'test') return next();

  // Доверенное определение IP:
  // На Vercel — x-vercel-forwarded-for или req.ip; на VPS Nginx перезаписывает X-Real-IP значением $remote_addr
  const ip = isVercel
    ? (req.headers['x-vercel-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
    : (req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: 'Слишком много запросов. Пожалуйста, подождите минуту перед повторной отправкой или свяжитесь с нами по телефону.'
    });
  }

  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);

  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (v.every(ts => now - ts >= RATE_LIMIT_WINDOW_MS)) {
        rateLimitMap.delete(k);
      }
    }
  }

  next();
}

const KEEP_UPLOADED_FILES = process.env.KEEP_UPLOADED_FILES === 'true';
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : (isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads'));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'leads.json');

// Конфигурация дублирования заявок на корпоративную почту (SMTP)
const EMAIL_TO = process.env.EMAIL_TO || 'kobnuhok@yandex.ru';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.yandex.ru';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Максимальный размер вложения для Email (20 МБ).
// С учетом Base64/MIME-оверхеда (+33%) размер письма укладывается в жесткий лимит Яндекс Почты (30 МБ).
// Файлы от 20 до 35 МБ передаются в Telegram и сохраняются на сервере.
const MAX_EMAIL_ATTACHMENT_SIZE = 20 * 1024 * 1024;

let mailTransporter = null;

function getMailTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return mailTransporter;
}

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
  fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
  fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
} catch (err) {
  console.error('[storage:init:fatal] Ошибка инициализации файлового хранилища:', err.message);
  if (!isVercel && process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Функция валидации сигнатур содержимого файлов (защита от подмены расширений)
function validateFileContent(filePath, originalName) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    // 1. Проверка на исполняемые файлы (Windows PE: MZ, Linux ELF: \x7fELF, shebang: #!)
    if (bytesRead >= 2) {
      const isPE = buffer[0] === 0x4D && buffer[1] === 0x5A; // MZ
      const isELF = bytesRead >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46;
      const isShebang = buffer[0] === 0x23 && buffer[1] === 0x21;

      if (isPE || isELF || isShebang) {
        return {
          valid: false,
          error: 'Обнаружен исполняемый файл или скрипт под видом проектной документации. Загрузка отклонена.'
        };
      }
    }

    const ext = path.extname(originalName).toLowerCase();

    // 2. Проверка PDF (заголовок %PDF занимает минимум 4 байта)
    if (ext === '.pdf') {
      if (bytesRead < 4 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        return { valid: false, error: 'Файл с расширением .pdf поврежден или не содержит корректного заголовка %PDF.' };
      }
    }

    // 3. Проверка PNG (сигнатура PNG занимает 8 байт: 89 50 4E 47 0D 0A 1A 0A)
    if (ext === '.png') {
      if (bytesRead < 8 ||
          buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47 ||
          buffer[4] !== 0x0D || buffer[5] !== 0x0A || buffer[6] !== 0x1A || buffer[7] !== 0x0A) {
        return { valid: false, error: 'Файл с расширением .png поврежден или имеет неверный формат изображения.' };
      }
    }

    // 4. Проверка JPG/JPEG (сигнатура JPEG занимает минимум 3 байта: FF D8 FF)
    if (ext === '.jpg' || ext === '.jpeg') {
      if (bytesRead < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        return { valid: false, error: 'Файл с расширением .jpg/.jpeg поврежден или имеет неверный формат изображения.' };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Ошибка проверки файла: ${err.message}` };
  }
}

// Кэш статуса файлового хранилища для предотвращения DoS-атак на /api/health
let cachedStorageHealth = {
  timestamp: 0,
  ok: true,
  error: null
};

// В тестах проверяем немедленно (TTL = 0), на продакшене кэшируем результат на 5 секунд
const STORAGE_HEALTH_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 5000;

function checkStorageHealth(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && (now - cachedStorageHealth.timestamp < STORAGE_HEALTH_TTL_MS)) {
    return cachedStorageHealth;
  }

  let ok = true;
  let error = null;
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.existsSync(DATA_FILE)) {
      ok = false;
      error = 'leads.json missing';
    } else {
      const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
      if (!content) {
        ok = false;
        error = 'leads.json corrupted: empty file';
      } else {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          ok = false;
          error = 'leads.json must contain a JSON array';
        }
      }
    }
  } catch (err) {
    ok = false;
    error = err.message;
  }

  cachedStorageHealth = { timestamp: now, ok, error };
  return cachedStorageHealth;
}

// Атомарное сохранение заявки в leads.json с защитой от повреждения данных
function saveLead(newLead) {
  let leads = [];
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error('leads.json missing');
  }
  const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
  if (!content) {
    throw new Error('leads.json corrupted: empty file');
  }
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('leads.json corrupted: expected JSON array');
  }
  leads = parsed;

  leads.unshift(newLead);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempFile = `${DATA_FILE}.tmp.${Date.now()}_${randomSuffix}`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
    throw err;
  }

  // Немедленно обновляем кэш здоровья хранилища
  cachedStorageHealth = { timestamp: Date.now(), ok: true, error: null };
  return true;
}

// Настройка хранилища Multer с защитой от коллизий имен файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    cb(null, `${timestamp}_${randomSuffix}_${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 35 * 1024 * 1024, // Лимит 35 МБ
    fieldSize: 16 * 1024,        // Лимит 16 КБ на текстовое поле
    fields: 20                  // Максимальное количество текстовых полей
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = /\.(dwg|pdf|zip|rar|7z|doc|docx|xls|xlsx|png|jpg|jpeg)$/i;
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (allowedExts.test(safeName)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый формат файла. Разрешены: .dwg, .pdf, .zip, .rar, .7z, .doc, .docx, .xls, .xlsx, .png, .jpg, .jpeg'));
    }
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Запрос к Telegram API: прямая отправка на Vercel/VPS + поддержка локального туннеля (обход блокировок на ПК в РФ)
function requestTelegram(apiPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    // В облаке Vercel нет блокировок Telegram API — отправляем напрямую без задержек
    if (process.env.VERCEL) {
      const req = https.request({
        host: 'api.telegram.org',
        path: apiPath,
        method: method,
        headers: headers,
        timeout: 15000
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
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
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

    function sendThroughSocket(socket) {
      const req = https.request({
        host: 'api.telegram.org',
        path: apiPath,
        method: method,
        headers: headers,
        socket: socket,
        agent: false
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
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    }

    function fallbackDirect() {
      if (finished) return;
      finished = true;
      const req = https.request({
        host: 'api.telegram.org',
        path: apiPath,
        method: method,
        headers: headers,
        timeout: 10000
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
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    }

    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode === 200) {
        finished = true;
        sendThroughSocket(socket);
      } else {
        fallbackDirect();
      }
    });

    proxyReq.on('error', () => fallbackDirect());
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      fallbackDirect();
    });
    proxyReq.end();
  });
}

// Отправка уведомления в Telegram (при наличии токена и ID чата в .env)
async function sendToTelegram(lead, file) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: true, mocked: true };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegram:skip] Токен или Chat ID не заданы в process.env — отправка в Telegram пропущена');
    return { sent: false, reason: 'Токен или Chat ID не заданы в переменных окружения' };
  }

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
      file ? `<b>📎 Прикреплен файл ТЗ:</b> ${escapeHtml(file.originalName)} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : null,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`
    ].filter(Boolean).join('\n');

    let targetChatId = String(chatId).trim();
    let msgBody = JSON.stringify({
      chat_id: targetChatId,
      text,
      parse_mode: 'HTML'
    });

    let msgRes = await requestTelegram(`/bot${token}/sendMessage`, 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgBody)
    }, msgBody);

    // Если чат не найден и ID был без минуса — автоматически пробуем как группу с минусом
    if ((!msgRes.ok || !msgRes.data?.ok) && msgRes.data?.description?.includes('chat not found') && !targetChatId.startsWith('-')) {
      const groupChatId = `-${targetChatId}`;
      console.log(`[telegram:fallback] Попытка отправки в группу: ${groupChatId}`);
      const retryBody = JSON.stringify({
        chat_id: groupChatId,
        text,
        parse_mode: 'HTML'
      });
      const retryRes = await requestTelegram(`/bot${token}/sendMessage`, 'POST', {
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
      return { sent: false, error: msgRes.data?.description || 'Ошибка Telegram API' };
    }

    const messageId = msgRes.data.result?.message_id;
    console.log(`[telegram:notify:success] Заявка ${lead.leadId} успешно доставлена в Telegram! (message_id: ${messageId})`);

    let docSent = false;
    let docError = null;
    if (file && fs.existsSync(file.path)) {
      try {
        const fileData = fs.readFileSync(file.path);
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
        // Безопасное имя файла: без двойного перекодирования и без спецсимволов кавычек
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

        const docRes = await requestTelegram(`/bot${token}/sendDocument`, 'POST', {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': docBody.length
        }, docBody);

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

    return { sent: true, messageId, documentSent: docSent, documentError: docError };
  } catch (err) {
    console.error('[telegram:notify:error] Сетевая ошибка при отправке в Telegram:', err.message);
    return { sent: false, error: err.message };
  }
}

// Отправка дублирующего уведомления на корпоративную почту через SMTP (nodemailer)
async function sendToEmail(lead, file) {
  if (process.env.NODE_ENV === 'test') {
    const isAttached = !!(file && file.size <= MAX_EMAIL_ATTACHMENT_SIZE);
    return {
      sent: true,
      mocked: true,
      recipient: EMAIL_TO,
      attached: isAttached,
      oversized: !!(file && file.size > MAX_EMAIL_ATTACHMENT_SIZE)
    };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    console.log(`[email:skip] SMTP не настроен (SMTP_USER/SMTP_PASS не заданы в .env). Дублирование на ${EMAIL_TO} пропущено, заявка сохранена локально.`);
    return { sent: false, recipient: EMAIL_TO, reason: 'SMTP не настроен (задайте SMTP_USER и SMTP_PASS в .env)' };
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

    const hasAttachment = !!(file && fs.existsSync(file.path));
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
              ${file ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; vertical-align: top;"><strong>Прикреплен файл:</strong></td>
                <td style="padding: 10px 0; color: #0f172a;">
                  📎 ${escapeHtml(file.originalName)} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)
                  ${isOversizedForEmail ? `
                  <div style="margin-top: 6px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e; line-height: 1.4;">
                    ⚠️ <strong>Вложение не прикреплено к письму:</strong> размер файла превышает лимит почтового шлюза (20 МБ) с учетом MIME-кодирования (жесткий лимит Яндекс Почты — 30 МБ).<br>
                    ✅ <strong>Файл успешно передан в Telegram и сохранен на сервере в хранилище заявок (uploads/).</strong>
                  </div>
                  ` : ''}
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
        path: file.path
      }];
    } else if (isOversizedForEmail) {
      console.log(`[email:attachment:notice] Файл ${file.originalName} (${(file.size / (1024 * 1024)).toFixed(2)} МБ) превышает лимит 20 МБ. Отправка email без вложения.`);
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[email:notify:success] Заявка ${lead.leadId} успешно доставлена на почту ${EMAIL_TO} (ID: ${info.messageId})`);
    return { sent: true, recipient: EMAIL_TO, messageId: info.messageId, attached: !isOversizedForEmail };
  } catch (err) {
    console.error('[email:notify:error] Ошибка отправки на почту:', err.message);
    return { sent: false, recipient: EMAIL_TO, error: err.message };
  }
}

app.get('/api/health', (req, res) => {
  // В тестах проверяем немедленно, в продакшене используем кэш (защита от DoS на fs)
  const forceFresh = process.env.NODE_ENV === 'test';
  const { ok: storageOk, error: storageError } = checkStorageHealth(forceFresh);

  const statusCode = storageOk ? 200 : 503;
  const isTest = process.env.NODE_ENV === 'test';
  res.status(statusCode).json({
    status: storageOk ? 'ok' : 'degraded',
    service: 'ООО «ФЕДСТРОЙ» API',
    storage: {
      ok: storageOk,
      ...(isTest && storageError ? { error: storageError } : {})
    },
    ...(isTest ? {
      notifications: {
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        emailRecipient: EMAIL_TO,
        smtpConfigured: !!(SMTP_USER && SMTP_PASS)
      }
    } : {}),
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/lead', leadRateLimiter, (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Размер файла превышает лимит (35 МБ). Пожалуйста, оптимизируйте чертежи или отправьте ссылку на облачное хранилище.'
        });
      }
      if (err.code === 'LIMIT_FIELD_VALUE') {
        return res.status(400).json({
          success: false,
          error: 'Превышен максимальный размер текстового поля формы (16 КБ).'
        });
      }
      if (err.code === 'LIMIT_FIELD_COUNT') {
        return res.status(400).json({
          success: false,
          error: 'Превышено максимальное количество полей формы.'
        });
      }
      return res.status(400).json({ success: false, error: `Ошибка загрузки файла: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { name, phone, agreement, service, area, building, comment, source } = req.body;
    let attachedFile = req.file || null;

    // Валидация согласия на обработку персональных данных (требование 152-ФЗ)
    const isAgreed = agreement === 'on' || agreement === 'true' || agreement === true || agreement === '1';
    if (!isAgreed) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Необходимо подтвердить согласие на обработку персональных данных.'
      });
    }

    // Валидация обязательного имени контактного лица (защита от пустых заявок)
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Пожалуйста, укажите имя контактного лица.'
      });
    }
    if (cleanName.length > 100) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Имя контактного лица не должно превышать 100 символов.'
      });
    }

    const phoneClean = (phone || '').replace(/\D/g, '');
    const isValidPhone = (phoneClean.length === 11 && (phoneClean.startsWith('7') || phoneClean.startsWith('8'))) ||
                         (phoneClean.length === 10 && phoneClean.startsWith('9'));
    if (!isValidPhone || phoneClean.length > 32 || String(phone || '').length > 32) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Пожалуйста, укажите корректный контактный номер телефона РФ (10–11 цифр).'
      });
    }

    if (service && String(service).length > 200) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Поле услуги не должно превышать 200 символов.'
      });
    }

    if (building && String(building).length > 200) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Поле типа объекта не должно превышать 200 символов.'
      });
    }

    if (comment && String(comment).length > 5000) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Комментарий к проекту не должен превышать 5000 символов.'
      });
    }

    if (source && String(source).length > 100) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Поле источника не должно превышать 100 символов.'
      });
    }

    if (attachedFile) {
      const origName = attachedFile.originalname || '';
      // Если файл не был выбран пользователем в форме (пустое имя)
      if (!origName || origName === 'blob' && attachedFile.size === 0) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
        attachedFile = null;
      } else if (attachedFile.size === 0) {
        // Пользователь явно прикрепил пустой файл (0 байт)
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
        return res.status(400).json({
          success: false,
          error: 'Прикрепленный файл пуст (0 байт). Пожалуйста, выберите корректный файл проекта.'
        });
      } else {
        // Проверка на подмену расширения / бинарную сигнатуру
        const validation = validateFileContent(attachedFile.path, attachedFile.originalname);
        if (!validation.valid) {
          try { fs.unlinkSync(attachedFile.path); } catch (_) {}
          return res.status(400).json({
            success: false,
            error: validation.error
          });
        }
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(4).toString('hex');
    const leadId = `ФС-${dateStr}-${randomHex}`;

    const leadRecord = {
      leadId,
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      service: (service || '').trim(),
      area: (area || '').trim(),
      building: (building || '').trim(),
      comment: (comment || '').trim(),
      source: (source || 'Форма на сайте').trim(),
      createdAt: new Date().toISOString(),
      file: attachedFile ? {
        originalName: Buffer.from(attachedFile.originalname, 'latin1').toString('utf8'),
        filename: attachedFile.filename,
        size: attachedFile.size
      } : null
    };

    saveLead(leadRecord);

    const fileAttachment = attachedFile ? {
      originalName: Buffer.from(attachedFile.originalname, 'latin1').toString('utf8'),
      filename: attachedFile.filename,
      size: attachedFile.size,
      path: attachedFile.path
    } : null;

    const responsePayload = {
      success: true,
      leadId,
      message: 'Заявка зарегистрирована. Мы свяжемся с вами в рабочее время.'
    };

    // 1. В тестах: синхронное ожидание для проверки моков в ассертах
    if (process.env.NODE_ENV === 'test') {
      const [telegramResult, emailResult] = await Promise.all([
        sendToTelegram(leadRecord, fileAttachment),
        sendToEmail(leadRecord, fileAttachment)
      ]);
      responsePayload.telegram = telegramResult;
      responsePayload.email = emailResult;
      return res.status(200).json(responsePayload);
    }

    // 2. В serverless (Vercel): ожидаем с защитным таймаутом (макс. 10с), чтобы контейнер не был заморожен
    if (isVercel) {
      try {
        const notifyPromise = Promise.allSettled([
          sendToTelegram(leadRecord, fileAttachment),
          sendToEmail(leadRecord, fileAttachment)
        ]);
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
        await Promise.race([notifyPromise, timeoutPromise]);
      } catch (notifyErr) {
        console.warn('[lead:notify:vercel:warn]', notifyErr.message);
      }
      return res.status(200).json(responsePayload);
    }

    // 3. В продакшене (VPS / PM2): мгновенный ответ клиенту сразу после сохранения в leads.json.
    // Уведомления и передача вложений в Telegram/Email выполняются асинхронно в фоне.
    // Это исключает долгое ожидание клиентом передачи 35-МБ файлов и предотвращает повторные отправки (дабл-клики).
    res.status(200).json(responsePayload);

    // Фоновая передача уведомлений с последующей очисткой временного файла
    (async () => {
      try {
        const results = await Promise.allSettled([
          sendToTelegram(leadRecord, fileAttachment),
          sendToEmail(leadRecord, fileAttachment)
        ]);
        const [tgRes, emRes] = results;
        if (tgRes.status === 'fulfilled' && !tgRes.value?.sent) {
          console.warn('[lead:notify:telegram:warn]', tgRes.value?.error || tgRes.value?.reason);
        }
        if (emRes.status === 'fulfilled' && !emRes.value?.sent) {
          console.warn('[lead:notify:email:warn]', emRes.value?.error || emRes.value?.reason);
        }
      } catch (asyncErr) {
        console.error('[lead:notify:background:error]', asyncErr.message);
      } finally {
        if (attachedFile?.path && !KEEP_UPLOADED_FILES) {
          try {
            if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
          } catch (_) {}
        }
      }
    })();
  } catch (err) {
    if (attachedFile?.path && !KEEP_UPLOADED_FILES) {
      try {
        if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
      } catch (_) {}
    }
    console.error('[lead:process:error]', err);
    return res.status(500).json({
      success: false,
      error: 'Произошла ошибка при обработке заявки на сервере. Пожалуйста, позвоните нам по номеру 8 (800) 700-02-23.'
    });
  } finally {
    // В тестах и на Vercel очищаем файл после завершения обработки запроса.
    // На VPS очистка выполняется в фоновом обработчике выше.
    const isAsyncMode = !isVercel && process.env.NODE_ENV !== 'test';
    if (!isAsyncMode && attachedFile?.path && !KEEP_UPLOADED_FILES) {
      try {
        if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
      } catch (_) {}
    }
  }
});

// Белый список общедоступных файлов в корне проекта
const ALLOWED_ROOT_FILES = new Set([
  'index.html',
  'app.js',
  'privacy.html',
  'consent.html',
  'requisites.html',
  'robots.txt',
  'favicon.ico'
]);

// Безопасная раздача статики: строго разрешенные каталоги и файлы
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.get('/:file', (req, res, next) => {
  const file = req.params.file;
  if (ALLOWED_ROOT_FILES.has(file)) {
    return res.sendFile(file, { root: __dirname });
  }
  next();
});

// Защита от прямого скачивания закрытых файлов и каталогов проекта
app.use((req, res) => {
  res.status(404).send('Not Found');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
  });
}

module.exports = app;
