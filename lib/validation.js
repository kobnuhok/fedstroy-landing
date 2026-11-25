// Request validation, rate limiting, and Multer file security checks.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOADS_DIR, isVercel } = require('./storage');

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/fedstroy-landing\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;

function leadRateLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

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
    fileSize: 35 * 1024 * 1024,
    fieldSize: 16 * 1024,
    fields: 20
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

function validateFileContent(filePath, originalName) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    fd = undefined;

    if (bytesRead >= 2) {
      const isPE = buffer[0] === 0x4D && buffer[1] === 0x5A;
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

    if (ext === '.pdf') {
      if (bytesRead < 4 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        return { valid: false, error: 'Файл с расширением .pdf поврежден или не содержит корректного заголовка %PDF.' };
      }
    }

    if (ext === '.png') {
      if (bytesRead < 8 ||
          buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47 ||
          buffer[4] !== 0x0D || buffer[5] !== 0x0A || buffer[6] !== 0x1A || buffer[7] !== 0x0A) {
        return { valid: false, error: 'Файл с расширением .png поврежден или имеет неверный формат изображения.' };
      }
    }

    if (ext === '.jpg' || ext === '.jpeg') {
      if (bytesRead < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        return { valid: false, error: 'Файл с расширением .jpg/.jpeg поврежден или имеет неверный формат изображения.' };
      }
    }

    if (ext === '.zip') {
      const isZip = bytesRead >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B &&
        ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
         (buffer[2] === 0x05 && buffer[3] === 0x06) ||
         (buffer[2] === 0x07 && buffer[3] === 0x08));
      if (!isZip) {
        return { valid: false, error: 'Файл с расширением .zip поврежден или не содержит корректного заголовка ZIP-архива (PK).' };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Ошибка проверки файла: ${err.message}` };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function validateLeadPayload(body) {
  const { name, phone, agreement, service, area, building, comment, source } = body || {};

  const isAgreed = agreement === 'on' || agreement === 'true' || agreement === true || agreement === '1';
  if (!isAgreed) {
    return 'Необходимо подтвердить согласие на обработку персональных данных.';
  }

  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return 'Пожалуйста, укажите имя контактного лица.';
  }
  if (cleanName.length > 100) {
    return 'Имя контактного лица не должно превышать 100 символов.';
  }

  const phoneClean = (phone || '').replace(/\D/g, '');
  const isValidPhone = (phoneClean.length === 11 && (phoneClean.startsWith('7') || phoneClean.startsWith('8'))) ||
                       (phoneClean.length === 10 && phoneClean.startsWith('9'));
  if (!isValidPhone || phoneClean.length > 32 || String(phone || '').length > 32) {
    return 'Пожалуйста, укажите корректный контактный номер телефона РФ (10–11 цифр).';
  }

  if (service && String(service).length > 200) {
    return 'Поле услуги не должно превышать 200 символов.';
  }
  if (building && String(building).length > 200) {
    return 'Поле типа объекта не должно превышать 200 символов.';
  }

  if (area) {
    const cleanArea = String(area).trim();
    if (cleanArea.length > 32) {
      return 'Поле площади не должно превышать 32 символов.';
    }
    const normalizedArea = cleanArea.replace(/\s+/g, ' ');
    const areaRegex = /^([0-9]+([.,][0-9]+)?|[0-9]{1,3}(\s[0-9]{3})+([.,][0-9]+)?)(\s*(м²|м2|кв\.?\s*м\.?))?$/i;
    if (!areaRegex.test(normalizedArea)) {
      return 'Пожалуйста, укажите корректную площадь объекта (например: 650 или 1 250 м²).';
    }
  }

  if (comment && String(comment).length > 5000) {
    return 'Комментарий к проекту не должен превышать 5000 символов.';
  }
  if (source && String(source).length > 250) {
    return 'Поле источника не должно превышать 250 символов.';
  }

  return null;
}

module.exports = {
  ALLOWED_ORIGIN_PATTERNS,
  leadRateLimiter,
  upload,
  validateFileContent,
  validateLeadPayload
};
