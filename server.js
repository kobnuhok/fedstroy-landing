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
  /^https:\/\/fedstroy-landing\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

const isVercel = !!process.env.VERCEL;

let vercelWaitUntil = null;
try {
  vercelWaitUntil = require('@vercel/functions').waitUntil;
} catch (_) {}

const MAX_NOTIFICATION_ATTEMPTS = 3;

// Ограничение параллельной отправки уведомлений для защиты RAM от всплесков при файлах до 35 МБ
// Действует per runtime instance (в PM2 на VPS запущен 1 процесс).
const MAX_CONCURRENT_NOTIFICATIONS = 2;
const MAX_NOTIFICATION_QUEUE = 50;
let activeNotificationJobs = 0;
const notificationQueue = [];

function runWithNotificationQueue(taskFn) {
  // В serverless (Vercel) экземпляры масштабируются платформой, лимит тела 4.5 МБ,
  // а задачи управляются через waitUntil. Выполняем напрямую, предотвращая QUEUE_OVERFLOW.
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

// In-memory буфер недозаписанных патчей статусов (на случай временных сбоев/блокировок leads.json на диске)
const MAX_UNPERSISTED_PATCHES = 1000;
const EMERGENCY_PATCHES_FILE = () => path.join(DATA_DIR, 'unpersisted_patches_emergency.json');
const unpersistedNotificationPatches = new Map();

function writeEmergencyFileAtomic(emergencyFile, data) {
  const content = JSON.stringify(data, null, 2);
  const tmpFile = `${emergencyFile}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, emergencyFile);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    throw err;
  }
}

let emergencyFileUnreadable = false;

function loadEmergencyPatches() {
  const emergencyFile = EMERGENCY_PATCHES_FILE();
  if (!fs.existsSync(emergencyFile)) {
    emergencyFileUnreadable = false;
    return {};
  }
  try {
    const raw = fs.readFileSync(emergencyFile, 'utf8').trim();
    if (!raw) {
      emergencyFileUnreadable = false;
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      emergencyFileUnreadable = false;
      return parsed;
    }
    throw new Error('Некорректная структура JSON: ожидался объект');
  } catch (err) {
    const corruptFile = `${emergencyFile}.corrupt.${Date.now()}`;
    console.error(`[lead:emergency:corrupt] Аварийный файл ${emergencyFile} поврежден (${err.message}). Переименование в ${corruptFile} для сохранения данных и ручного анализа.`);
    try {
      fs.renameSync(emergencyFile, corruptFile);
      emergencyFileUnreadable = false;
    } catch (renameErr) {
      emergencyFileUnreadable = true;
      console.error(`[lead:emergency:corrupt-rename-fail] Не удалось переименовать поврежденный файл: ${renameErr.message}`);
    }
    return {};
  }
}

function getUnpersistedNotificationPatch(leadId, emergencyCache = null) {
  if (unpersistedNotificationPatches.has(leadId)) {
    return unpersistedNotificationPatches.get(leadId);
  }
  const emergencyData = emergencyCache || loadEmergencyPatches();
  return (emergencyData && emergencyData[leadId]) || null;
}

function enqueueUnpersistedNotificationPatch(leadId, patch) {
  if (unpersistedNotificationPatches.size >= MAX_UNPERSISTED_PATCHES && !unpersistedNotificationPatches.has(leadId)) {
    console.error(`[lead:unpersisted-patches:emergency] Достигнут лимит буфера (${MAX_UNPERSISTED_PATCHES}). Аварийная запись во внешний fallback-файл.`);
    try {
      const emergencyFile = EMERGENCY_PATCHES_FILE();
      let existingEmergency = loadEmergencyPatches();
      existingEmergency[leadId] = { ...(existingEmergency[leadId] || {}), ...patch };
      writeEmergencyFileAtomic(emergencyFile, existingEmergency);
      // При успешной записи в аварийный файл НЕ помещаем элемент в Map,
      // гарантируя жесткое соблюдение лимита unpersistedNotificationPatches.size <= MAX_UNPERSISTED_PATCHES
      return;
    } catch (eErr) {
      console.error('[lead:unpersisted-patches:fatal-disk]', eErr.message);
      const oldestKey = unpersistedNotificationPatches.keys().next().value;
      if (oldestKey) {
        console.warn(`[lead:unpersisted-patches:evict] Вытеснение старейшей записи ${oldestKey} для сохранения статуса ${leadId}`);
        unpersistedNotificationPatches.delete(oldestKey);
      }
    }
  }
  const existing = unpersistedNotificationPatches.get(leadId) || {};
  unpersistedNotificationPatches.set(leadId, { ...existing, ...patch });
}

function flushUnpersistedNotificationPatches() {
  const emergencyFile = EMERGENCY_PATCHES_FILE();
  let emergencyData = loadEmergencyPatches();

  const allLeadIds = new Set([
    ...unpersistedNotificationPatches.keys(),
    ...Object.keys(emergencyData)
  ]);

  if (allLeadIds.size === 0) {
    if (fs.existsSync(emergencyFile) && !emergencyFileUnreadable) {
      try { fs.unlinkSync(emergencyFile); } catch (_) {}
    }
    return !emergencyFileUnreadable;
  }

  let allSaved = true;
  for (const leadId of allLeadIds) {
    const patch = {
      ...(emergencyData[leadId] || {}),
      ...(unpersistedNotificationPatches.get(leadId) || {})
    };
    const ok = updateLeadNotificationStatus(leadId, patch, 2);
    if (ok) {
      unpersistedNotificationPatches.delete(leadId);
      delete emergencyData[leadId];
      console.log(`[lead:notification-state:recovered] Статус заявки ${leadId} успешно синхронизирован с диском`);
    } else {
      allSaved = false;
    }
  }

  // Обновляем аварийный файл на диске: удаляем только если ВСЕ патчи сохранены.
  // Если диск все еще недоступен, сохраняем несохраненные данные в аварийном файле для защиты от краша Node/PM2.
  if (Object.keys(emergencyData).length > 0) {
    try {
      writeEmergencyFileAtomic(emergencyFile, emergencyData);
    } catch (_) {}
  } else if (fs.existsSync(emergencyFile) && allSaved && !emergencyFileUnreadable) {
    try {
      fs.unlinkSync(emergencyFile);
    } catch (_) {}
  }

  return allSaved && !emergencyFileUnreadable;
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    if (unpersistedNotificationPatches.size > 0) {
      flushUnpersistedNotificationPatches();
    }
  }, 5000).unref();
}

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

const shouldKeepUploadedFiles = () => process.env.KEEP_UPLOADED_FILES === 'true';
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

// Атомарное обновление статуса доставки уведомлений в leads.json с контролем ошибок и retry
function updateLeadNotificationStatus(leadId, patch, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let tempFile = null;
    try {
      if (!fs.existsSync(DATA_FILE)) return false;
      const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
      if (!content) return false;
      const leads = JSON.parse(content);
      if (!Array.isArray(leads)) return false;
      const lead = leads.find(l => l.leadId === leadId);
      if (!lead) return false;

      const prevNotif = lead.notifications || {};
      const prevAttempts = prevNotif.attempts || {
        telegram: (prevNotif.telegram && prevNotif.telegram !== 'pending') ? 1 : 0,
        email: (prevNotif.email && prevNotif.email !== 'pending') ? 1 : 0
      };

      const newAttempts = {
        telegram: patch.incTelegramAttempt ? (prevAttempts.telegram + 1) : (patch.telegramAttempts ?? prevAttempts.telegram),
        email: patch.incEmailAttempt ? (prevAttempts.email + 1) : (patch.emailAttempts ?? prevAttempts.email)
      };

      const cleanPatch = { ...patch };
      delete cleanPatch.incTelegramAttempt;
      delete cleanPatch.incEmailAttempt;
      delete cleanPatch.telegramAttempts;
      delete cleanPatch.emailAttempts;

      lead.notifications = {
        ...prevNotif,
        ...cleanPatch,
        attempts: newAttempts,
        updatedAt: new Date().toISOString()
      };

      // Очистка устаревших флагов ошибок при успешной доставке (data consistency)
      if (lead.notifications.telegram === 'sent') {
        delete lead.notifications.telegramDocError;
        delete lead.notifications.fileMissing;
      }
      if (lead.notifications.email === 'sent') {
        delete lead.notifications.emailError;
      }
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      tempFile = `${DATA_FILE}.tmp.${Date.now()}_${randomSuffix}`;
      fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
      fs.renameSync(tempFile, DATA_FILE);
      return true;
    } catch (err) {
      if (tempFile && fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch (_) {}
      }
      if (attempt === maxRetries) {
        console.error(`[lead:status:fatal] Не удалось обновить статус заявки ${leadId} после ${maxRetries} попыток:`, err.message);
        return false;
      }
    }
  }
  return false;
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

const TELEGRAM_REQUEST_TIMEOUT_MS = 15000;

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
        timeout: TELEGRAM_REQUEST_TIMEOUT_MS
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
        req.destroy(new Error(`Telegram request timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms (Vercel direct)`));
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
        agent: false,
        timeout: TELEGRAM_REQUEST_TIMEOUT_MS
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
        req.destroy(new Error(`Telegram request timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms (Proxy socket)`));
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
        timeout: TELEGRAM_REQUEST_TIMEOUT_MS
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
        req.destroy(new Error(`Telegram direct request timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms (Fallback direct)`));
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
      fileMissing: fileMissing,
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

      let msgBody = JSON.stringify({
        chat_id: targetChatId,
        text,
        parse_mode: 'HTML'
      });

      let msgRes = await requestFn(`/bot${token}/sendMessage`, 'POST', {
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

// Отправка дублирующего уведомления на корпоративную почту через SMTP (nodemailer)
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
                    📁 <strong>Файл сохранен на сервере в каталоге заявок (uploads/) и направляется в Telegram-чат ПТО отдельным каналом.</strong>
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

app.all(['/api/internal/retry', '/api/internal/recovery'], async (req, res) => {
  // Разрешаем только GET (для Vercel Cron) и POST (для Admin / Webhook / CI/CD)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_RECOVERY_TOKEN;
  if (!cronSecret) {
    // В боевом окружении: если секрет не сконфигурирован — endpoint закрыт (Fail-Closed)
    if (process.env.NODE_ENV !== 'test') {
      return res.status(503).json({ error: 'Recovery endpoint is not configured (CRON_SECRET missing)' });
    }
  } else {
    // Строгая аутентификация только через заголовок Authorization: Bearer <secret>
    // Исключаем ?token= и произвольные кастомные заголовки для предотвращения утечек в access-логи и proxy
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized: invalid recovery secret' });
    }
  }

  const result = await retryPendingNotifications(true);
  if (!result || result.success === false) {
    return res.status(500).json({
      error: 'Recovery failed',
      details: result?.error || 'System error during recovery',
      processed: result?.processed || 0,
      runtime: isVercel ? 'vercel-serverless-ephemeral' : 'persistent-vps',
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    processed: result.processed || 0,
    totalBatch: result.totalBatch || 0,
    unprocessed: result.unprocessed !== undefined ? result.unprocessed : 0,
    remaining: result.remaining || 0,
    runtime: isVercel ? 'vercel-serverless-ephemeral' : 'persistent-vps',
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
      notifications: {
        telegram: 'pending',
        email: 'pending',
        attempts: {
          telegram: 0,
          email: 0
        },
        updatedAt: new Date().toISOString()
      },
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

    const recordNotificationResults = (tgRes, emRes) => {
      const tgStatus = tgRes?.fullyDelivered ? 'sent' : ((tgRes?.messageSent || tgRes?.messageSkipped) ? 'partial' : 'failed');
      const emStatus = emRes?.sent ? 'sent' : 'failed';
      const patch = {
        telegram: tgStatus,
        email: emStatus,
        incTelegramAttempt: true,
        incEmailAttempt: true,
        ...(tgRes?.messageId ? { telegramMessageId: tgRes.messageId } : {}),
        ...(tgRes?.documentSent !== null && tgRes?.documentSent !== undefined ? { telegramDocSent: tgRes.documentSent } : {}),
        ...(emRes?.messageId ? { emailMessageId: emRes.messageId } : {}),
        ...(tgRes?.documentError ? { telegramDocError: tgRes.documentError } : {}),
        ...(tgRes?.fileMissing ? { fileMissing: true } : {}),
        ...(emRes?.error ? { emailError: emRes.error } : {})
      };

      const saved = updateLeadNotificationStatus(leadRecord.leadId, patch);
      if (!saved) {
        console.error(`[lead:notification-state:fatal] Не удалось сохранить статус уведомлений для заявки ${leadRecord.leadId}! Постановка в буфер отложенной синхронизации.`);
        enqueueUnpersistedNotificationPatch(leadRecord.leadId, patch);
      }
      return saved;
    };

    const responsePayload = {
      success: true,
      leadId,
      message: 'Заявка зарегистрирована. Мы свяжемся с вами в рабочее время.'
    };

    // 1. В тестах: синхронное ожидание для проверки моков в ассертах
    if (process.env.NODE_ENV === 'test') {
      const [telegramResult, emailResult] = await runWithNotificationQueue(() => Promise.all([
        sendToTelegram(leadRecord, fileAttachment),
        sendToEmail(leadRecord, fileAttachment)
      ]));
      recordNotificationResults(telegramResult, emailResult);
      responsePayload.telegram = telegramResult;
      responsePayload.email = emailResult;
      return res.status(200).json(responsePayload);
    }

    // 2. В serverless (Vercel): регистрация background job через @vercel/functions waitUntil
    // Либо защитный таймаут Promise.race (fallback).
    // Очистка файла строго привязана к завершению notifyPromise, исключая гонку с таймаутом.
    if (isVercel) {
      const notifyPromise = runWithNotificationQueue(() => Promise.allSettled([
        sendToTelegram(leadRecord, fileAttachment),
        sendToEmail(leadRecord, fileAttachment)
      ])).then(([tgSettled, emSettled]) => {
        const tgRes = tgSettled.status === 'fulfilled' ? tgSettled.value : { fullyDelivered: false, messageSent: false, error: tgSettled.reason?.message };
        const emRes = emSettled.status === 'fulfilled' ? emSettled.value : { sent: false, error: emSettled.reason?.message };
        recordNotificationResults(tgRes, emRes);
      }).catch(err => {
        console.error('[lead:notify:vercel:error]', err.message);
      }).finally(() => {
        const pendingPatch = getUnpersistedNotificationPatch(leadRecord.leadId);
        const currentNotif = pendingPatch ? { ...leadRecord.notifications, ...pendingPatch } : leadRecord.notifications;
        const tgRetryable = shouldRetryTelegram(currentNotif);
        const emRetryable = shouldRetryEmail(currentNotif);
        const needsFile = emRetryable || (tgRetryable && currentNotif?.telegramDocSent !== true);
        if (!needsFile && attachedFile?.path && !shouldKeepUploadedFiles()) {
          try {
            if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
          } catch (_) {}
        }
      });

      if (typeof vercelWaitUntil === 'function') {
        vercelWaitUntil(notifyPromise);
        return res.status(200).json(responsePayload);
      }

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
      await Promise.race([notifyPromise, timeoutPromise]);
      return res.status(200).json(responsePayload);
    }

    // 3. В продакшене (VPS / PM2): мгновенный ответ клиенту сразу после сохранения в leads.json.
    // Уведомления выполняются асинхронно в фоне через семафор параллельности (макс 2 одновременные задачи).
    // Статус доставки обновляется в leads.json (sent/failed/partial).
    // Это исключает скачки памяти (RAM spike) при одновременных заявках с 35-МБ файлами и предотвращает дабл-клики.
    res.status(200).json(responsePayload);

    // Фоновая передача уведомлений в очереди с семафором и очисткой временного файла
    runWithNotificationQueue(async () => {
      try {
        const results = await Promise.allSettled([
          sendToTelegram(leadRecord, fileAttachment),
          sendToEmail(leadRecord, fileAttachment)
        ]);
        const [tgSettled, emSettled] = results;
        const tgRes = tgSettled.status === 'fulfilled' ? tgSettled.value : { fullyDelivered: false, messageSent: false, error: tgSettled.reason?.message };
        const emRes = emSettled.status === 'fulfilled' ? emSettled.value : { sent: false, error: emSettled.reason?.message };
        recordNotificationResults(tgRes, emRes);

        if (tgRes && !tgRes.sent && !tgRes.fullyDelivered) {
          console.warn('[lead:notify:telegram:warn]', tgRes.error || tgRes.reason);
        }
        if (emRes && !emRes.sent) {
          console.warn('[lead:notify:email:warn]', emRes.error || emRes.reason);
        }
      } catch (asyncErr) {
        console.error('[lead:notify:background:error]', asyncErr.message);
      } finally {
        const pendingPatch = getUnpersistedNotificationPatch(leadRecord.leadId);
        const currentNotif = pendingPatch ? { ...leadRecord.notifications, ...pendingPatch } : leadRecord.notifications;
        const tgRetryable = shouldRetryTelegram(currentNotif);
        const emRetryable = shouldRetryEmail(currentNotif);
        const needsFile = emRetryable || (tgRetryable && currentNotif?.telegramDocSent !== true);
        if (!needsFile && attachedFile?.path && !shouldKeepUploadedFiles()) {
          try {
            if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
          } catch (_) {}
        }
      }
    }).catch(err => {
      if (err.code === 'QUEUE_OVERFLOW') {
        console.warn(`[lead:notify:backpressure] Очередь уведомлений переполнена (${MAX_NOTIFICATION_QUEUE}). Заявка ${leadRecord.leadId} зарегистрирована в leads.json со статусом pending и будет обработана через retry.`);
      } else {
        console.error('[lead:notify:queue:fatal]', err.message);
      }
    });
  } catch (err) {
    if (attachedFile?.path && !shouldKeepUploadedFiles()) {
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
    // В тестах очищаем файл синхронно после обработки запроса, если ни один канал не требует повтора.
    // На Vercel и VPS очистка привязана к завершению notifyPromise/фоновой задачи.
    if (process.env.NODE_ENV === 'test' && attachedFile?.path && !shouldKeepUploadedFiles()) {
      const pendingPatch = getUnpersistedNotificationPatch(leadRecord?.leadId);
      const currentNotif = pendingPatch ? { ...(leadRecord?.notifications || {}), ...pendingPatch } : (leadRecord?.notifications || {});
      const tgRetryable = shouldRetryTelegram(currentNotif);
      const emRetryable = shouldRetryEmail(currentNotif);
      const needsFile = emRetryable || (tgRetryable && currentNotif?.telegramDocSent !== true);
      if (!needsFile) {
        try {
          if (fs.existsSync(attachedFile.path)) fs.unlinkSync(attachedFile.path);
        } catch (_) {}
      }
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

const activeRecoveryLeadIds = new Set();
let isRecoveryRunning = false;

const DEFAULT_RECOVERY_BATCH_SIZE = 20;
const MIN_RECOVERY_BATCH_SIZE = 1;
const MAX_RECOVERY_BATCH_SIZE = 100;

function getRecoveryBatchSize() {
  const envVal = process.env.RECOVERY_BATCH_SIZE;
  if (envVal !== undefined && envVal !== null && String(envVal).trim() !== '') {
    const parsed = Number(envVal);
    if (Number.isInteger(parsed) && parsed >= MIN_RECOVERY_BATCH_SIZE && parsed <= MAX_RECOVERY_BATCH_SIZE) {
      return parsed;
    }
  }
  return DEFAULT_RECOVERY_BATCH_SIZE;
}

// Повторная отправка недоставленных уведомлений при старте сервера или по крону
async function retryPendingNotifications(force = false) {
  if (!force && (process.env.NODE_ENV === 'test' && !process.env.TEST_ENABLE_STARTUP_RETRY) || (!force && isVercel)) {
    return { success: true, skipped: true, reason: 'startup retry disabled' };
  }
  if (!fs.existsSync(DATA_FILE)) {
    return { success: true, processed: 0, totalBatch: 0, unprocessed: 0, remaining: 0 };
  }

  if (isRecoveryRunning) {
    console.log('[notify:recovery] Пропуск: recovery sweep уже выполняется.');
    return { success: true, skipped: true, reason: 'recovery sweep already running' };
  }
  isRecoveryRunning = true;

  let processedCount = 0;
  let totalBatchCount = 0;
  let unprocessedCount = 0;
  let remainingCount = 0;
  let batchUnresolvedRetryableCount = 0;

  // Синхронизируем накопившиеся отложенные патчи перед чтением с диска
  flushUnpersistedNotificationPatches();

  try {
    const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (!content) {
      return { success: true, processed: 0, totalBatch: 0, unprocessed: 0, remaining: 0 };
    }
    const leads = JSON.parse(content);
    if (!Array.isArray(leads)) {
      throw new Error('leads.json is not a valid JSON array');
    }

    // Загружаем аварийные патчи ОДИН раз для всего прохода recovery sweep (без повторного парсинга на каждой заявке)
    const emergencyPatchesCache = loadEmergencyPatches();

    const allRetryableLeads = leads.filter(l => {
      const pendingPatch = getUnpersistedNotificationPatch(l.leadId, emergencyPatchesCache);
      const effectiveNotif = pendingPatch ? { ...l.notifications, ...pendingPatch } : l.notifications;
      return shouldRetryTelegram(effectiveNotif) || shouldRetryEmail(effectiveNotif);
    });

    const totalRetryable = allRetryableLeads.length;
    const batchLimit = getRecoveryBatchSize();
    // Ограничиваем размер пачки за один проход (по умолчанию 20, диапазон 1..100),
    // чтобы serverless functions (Vercel) не падали по таймауту при большом объеме накопившихся заявок
    const retryableLeads = allRetryableLeads.slice(0, batchLimit);
    totalBatchCount = retryableLeads.length;
    unprocessedCount = Math.max(0, totalRetryable - totalBatchCount);

    if (retryableLeads.length > 0) {
      console.log(`[notify:recovery] Найдено ${totalRetryable} заявок, обрабатываем пачку из ${totalBatchCount} (не вошло в пачку: ${unprocessedCount}).`);
      for (const lead of retryableLeads) {
        if (activeRecoveryLeadIds.has(lead.leadId)) {
          console.log(`[notify:recovery] Заявка ${lead.leadId} уже обрабатывается в активном потоке recovery, пропуск.`);
          batchUnresolvedRetryableCount++;
          continue;
        }
        activeRecoveryLeadIds.add(lead.leadId);

        try {
          await runWithNotificationQueue(async () => {
            const pendingPatch = getUnpersistedNotificationPatch(lead.leadId, emergencyPatchesCache);
            const effectiveNotif = pendingPatch ? { ...lead.notifications, ...pendingPatch } : (lead.notifications || {});
            const effectiveLead = { ...lead, notifications: effectiveNotif };

            const fileExpected = !!effectiveLead.file;
            let fileAttachment = null;
            let fileMissing = false;

            if (fileExpected) {
              const filename = effectiveLead.file.filename;
              const filePath = filename ? path.join(UPLOADS_DIR, filename) : null;
              if (filePath && fs.existsSync(filePath)) {
                fileAttachment = {
                  originalName: effectiveLead.file.originalName,
                  filename: effectiveLead.file.filename,
                  size: effectiveLead.file.size,
                  path: filePath
                };
              } else {
                fileMissing = true;
              }
            }

            const doRetryTelegram = shouldRetryTelegram(effectiveNotif);
            const doRetryEmail = shouldRetryEmail(effectiveNotif);

            // Если Telegram уже в статусе 'partial' (текстовое сообщение ранее уже было доставлено),
            // а файл физически отсутствует на сервере — повторно слать текст в чат не имеет смысла:
            // фиксируем partial и отказ от повтора.
            let skipTelegramSend = false;
            if (doRetryTelegram && effectiveNotif.telegram === 'partial' && fileMissing) {
              skipTelegramSend = true;
              const skipPatch = {
                telegram: 'partial',
                telegramDocError: 'Вложение отсутствует на диске сервера, повтор отменен',
                fileMissing: true,
                incTelegramAttempt: true
              };
              const saved = updateLeadNotificationStatus(effectiveLead.leadId, skipPatch);
              if (!saved) {
                console.error(`[lead:notification-state:fatal] Не удалось обновить статус заявки ${effectiveLead.leadId}! Постановка в буфер отложенной синхронизации.`);
                enqueueUnpersistedNotificationPatch(effectiveLead.leadId, skipPatch);
              }
            }

            const isPartialWithText = effectiveNotif.telegram === 'partial' && !!effectiveNotif.telegramMessageId;
            const sendTgFn = app.sendToTelegram || sendToTelegram;
            const sendEmFn = app.sendToEmail || sendToEmail;

            const tasks = [];
            if (doRetryTelegram && !skipTelegramSend) {
              tasks.push(sendTgFn(effectiveLead, fileAttachment, { onlyDocument: isPartialWithText }));
            } else {
              tasks.push(Promise.resolve(null));
            }

            if (doRetryEmail) {
              tasks.push(sendEmFn(effectiveLead, fileAttachment));
            } else {
              tasks.push(Promise.resolve(null));
            }

            const [tgSettled, emSettled] = await Promise.allSettled(tasks);
            const patch = {};

            if (tgSettled.status === 'fulfilled' && tgSettled.value) {
              const tgVal = tgSettled.value;
              patch.telegram = tgVal.fullyDelivered ? 'sent' : ((tgVal.messageSent || tgVal.messageSkipped) ? 'partial' : 'failed');
              patch.incTelegramAttempt = true;
              if (tgVal.messageId) patch.telegramMessageId = tgVal.messageId;
              if (tgVal.documentSent !== null && tgVal.documentSent !== undefined) patch.telegramDocSent = tgVal.documentSent;
              if (tgVal.documentError) patch.telegramDocError = tgVal.documentError;
              if (tgVal.fileMissing) patch.fileMissing = true;
            } else if (tgSettled.status === 'rejected') {
              patch.telegram = 'failed';
              patch.incTelegramAttempt = true;
              patch.telegramDocError = tgSettled.reason?.message || 'Неизвестная ошибка Telegram';
            }

            if (emSettled.status === 'fulfilled' && emSettled.value) {
              const emVal = emSettled.value;
              patch.email = emVal.sent ? 'sent' : 'failed';
              patch.incEmailAttempt = true;
              if (emVal.messageId) patch.emailMessageId = emVal.messageId;
              if (emVal.error) patch.emailError = emVal.error;
              if (fileMissing) patch.fileMissing = true;
            } else if (emSettled.status === 'rejected') {
              patch.email = 'failed';
              patch.incEmailAttempt = true;
              patch.emailError = emSettled.reason?.message || 'Неизвестная ошибка Email';
            }

            if (Object.keys(patch).length > 0) {
              const saved = updateLeadNotificationStatus(effectiveLead.leadId, patch);
              if (!saved) {
                console.error(`[lead:notification-state:fatal] Не удалось обновить статус заявки ${effectiveLead.leadId} при retry! Постановка в буфер отложенной синхронизации.`);
                enqueueUnpersistedNotificationPatch(effectiveLead.leadId, patch);
              } else {
                effectiveLead.notifications = {
                  ...effectiveLead.notifications,
                  ...patch
                };
              }
            }

            // Очищаем локальный файл после завершения retry, если ни один канал больше не требует повтора
            const currentPending = getUnpersistedNotificationPatch(effectiveLead.leadId);
            const finalNotif = currentPending ? { ...effectiveLead.notifications, ...currentPending } : effectiveLead.notifications;
            const tgStillRetryable = shouldRetryTelegram(finalNotif);
            const emStillRetryable = shouldRetryEmail(finalNotif);
            if (tgStillRetryable || emStillRetryable) {
              batchUnresolvedRetryableCount++;
            }
            const stillNeedsFile = emStillRetryable || (tgStillRetryable && finalNotif?.telegramDocSent !== true);
            if (!stillNeedsFile && fileAttachment?.path && !shouldKeepUploadedFiles()) {
              try {
                if (fs.existsSync(fileAttachment.path)) fs.unlinkSync(fileAttachment.path);
              } catch (_) {}
            }

            processedCount++;
          });
        } catch (leadErr) {
          console.error(`[notify:recovery:lead-fail] Сбой при обработке заявки ${lead.leadId}:`, leadErr.message);
          batchUnresolvedRetryableCount++;
        } finally {
          activeRecoveryLeadIds.delete(lead.leadId);
        }
      }
      console.log(`[notify:recovery] Повторная отправка пачки завершена (обработано: ${processedCount}).`);
    }

    remainingCount = unprocessedCount + batchUnresolvedRetryableCount;

    return {
      success: true,
      processed: processedCount,
      totalBatch: totalBatchCount,
      unprocessed: unprocessedCount,
      remaining: remainingCount
    };
  } catch (err) {
    console.error('[notify:recovery:error] Ошибка при повторной отправке заявок:', err.message);
    return {
      success: false,
      error: err.message,
      processed: processedCount,
      totalBatch: totalBatchCount,
      unprocessed: unprocessedCount,
      remaining: unprocessedCount + batchUnresolvedRetryableCount
    };
  } finally {
    isRecoveryRunning = false;
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
    retryPendingNotifications().catch(e => console.error('[notify:recovery:fatal]', e.message));
  });
}

app.retryPendingNotifications = retryPendingNotifications;
app.shouldRetryTelegram = shouldRetryTelegram;
app.shouldRetryEmail = shouldRetryEmail;
app.MAX_NOTIFICATION_ATTEMPTS = MAX_NOTIFICATION_ATTEMPTS;
app.runWithNotificationQueue = runWithNotificationQueue;
app.MAX_CONCURRENT_NOTIFICATIONS = MAX_CONCURRENT_NOTIFICATIONS;
app.MAX_NOTIFICATION_QUEUE = MAX_NOTIFICATION_QUEUE;
app.updateLeadNotificationStatus = updateLeadNotificationStatus;
app.sendToTelegram = sendToTelegram;
app.sendToEmail = sendToEmail;
app.requestTelegram = requestTelegram;
app.TELEGRAM_REQUEST_TIMEOUT_MS = TELEGRAM_REQUEST_TIMEOUT_MS;
app.unpersistedNotificationPatches = unpersistedNotificationPatches;
app.getUnpersistedNotificationPatch = getUnpersistedNotificationPatch;
app.activeRecoveryLeadIds = activeRecoveryLeadIds;
app.enqueueUnpersistedNotificationPatch = enqueueUnpersistedNotificationPatch;
app.flushUnpersistedNotificationPatches = flushUnpersistedNotificationPatches;
app.loadEmergencyPatches = loadEmergencyPatches;
app.writeEmergencyFileAtomic = writeEmergencyFileAtomic;
Object.defineProperty(app, 'MAX_RECOVERY_BATCH', {
  get: () => getRecoveryBatchSize(),
  enumerable: true,
  configurable: true
});
app.getRecoveryBatchSize = getRecoveryBatchSize;
app.isEmergencyFileUnreadable = () => emergencyFileUnreadable;
app.ALLOWED_ORIGIN_PATTERNS = ALLOWED_ORIGIN_PATTERNS;

module.exports = app;
