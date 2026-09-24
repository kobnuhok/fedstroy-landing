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

const app = express();
const PORT = process.env.PORT || 8080;

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/kobnuhok\.github\.io$/,
  /^https:\/\/(www\.)?ooofedstroy\.ru$/,
  /^https:\/\/fedstroy-landing(-[a-zA-Z0-9-]+)?\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

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

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
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

const isVercel = !!process.env.VERCEL;
const UPLOADS_DIR = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
} catch (err) {
  console.warn('[fs:init:warn]', err.message);
}

// Функция валидации сигнатур содержимого файлов (защита от подмены расширений)
function validateFileContent(filePath, originalName) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (bytesRead < 2) return { valid: true };

    // 1. Проверка на исполняемые файлы (Windows PE: MZ, Linux ELF: \x7fELF, shebang: #!)
    const isPE = buffer[0] === 0x4D && buffer[1] === 0x5A; // MZ
    const isELF = buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46;
    const isShebang = buffer[0] === 0x23 && buffer[1] === 0x21;

    if (isPE || isELF || isShebang) {
      return {
        valid: false,
        error: 'Обнаружен исполняемый файл или скрипт под видом проектной документации. Загрузка отклонена.'
      };
    }

    const ext = path.extname(originalName).toLowerCase();
    // 2. Проверка PDF
    if (ext === '.pdf') {
      const magic = buffer.subarray(0, 4).toString('ascii');
      if (magic !== '%PDF') {
        return { valid: false, error: 'Файл с расширением .pdf не содержит корректного заголовка документа PDF.' };
      }
    }

    // 3. Проверка PNG
    if (ext === '.png') {
      if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
        return { valid: false, error: 'Файл с расширением .png поврежден или имеет неверный формат изображения.' };
      }
    }

    // 4. Проверка JPG
    if (ext === '.jpg' || ext === '.jpeg') {
      if (buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        return { valid: false, error: 'Файл с расширением .jpg/.jpeg поврежден или имеет неверный формат изображения.' };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Ошибка проверки файла: ${err.message}` };
  }
}

// Атомарное сохранение заявки в leads.json с защитой от повреждения данных
function saveLead(newLead) {
  let leads = [];
  if (fs.existsSync(DATA_FILE)) {
    const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (content) {
      // Если файл повреждён — выбрасываем исключение, предотвращая потерю или порчу данных
      leads = JSON.parse(content);
    }
  }

  leads.unshift(newLead);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempFile = `${DATA_FILE}.tmp.${Date.now()}_${randomSuffix}`;
  fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
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
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    cb(null, `${timestamp}_${randomSuffix}_${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 35 * 1024 * 1024 }, // Лимит 35 МБ
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        timeout: 60000
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
    console.warn('[telegram:skip] Токен или Chat ID не заданы в process.env — отправка пропущена');
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
      } finally {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    return { sent: true, messageId, documentSent: docSent, documentError: docError };
  } catch (err) {
    console.error('[telegram:notify:error] Сетевая ошибка при отправке в Telegram:', err.message);
    return { sent: false, error: err.message };
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ООО «ФЕДСТРОЙ» API',
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
      return res.status(400).json({ success: false, error: `Ошибка загрузки файла: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { name, phone, service, area, building, comment, source } = req.body;
    let attachedFile = req.file || null;

    const phoneClean = (phone || '').replace(/\D/g, '');
    const isValidPhone = (phoneClean.length === 11 && (phoneClean.startsWith('7') || phoneClean.startsWith('8'))) ||
                         (phoneClean.length === 10 && phoneClean.startsWith('9'));
    if (!isValidPhone) {
      if (attachedFile?.path) {
        try { fs.unlinkSync(attachedFile.path); } catch (_) {}
      }
      return res.status(400).json({
        success: false,
        error: 'Пожалуйста, укажите корректный контактный номер телефона РФ (10–11 цифр).'
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

    const newLead = {
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
        size: attachedFile.size,
        path: attachedFile.path
      } : null
    };

    saveLead(newLead);
    const telegramResult = await sendToTelegram(newLead, newLead.file);

    return res.status(200).json({
      success: true,
      leadId,
      telegram: telegramResult,
      message: 'Заявка зарегистрирована. Инженер ПТО получит уведомление.'
    });
  } catch (err) {
    if (attachedFile?.path) {
      try { fs.unlinkSync(attachedFile.path); } catch (_) {}
    }
    console.error('[lead:process:error]', err);
    return res.status(500).json({
      success: false,
      error: 'Произошла ошибка при обработке заявки на сервере. Пожалуйста, позвоните нам по номеру 8 (800) 700-02-23.'
    });
  }
});

app.use(express.static(__dirname));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
  });
}

module.exports = app;
