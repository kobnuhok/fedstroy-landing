// Express API сервер ООО «ФЕДСТРОЙ»: прием заявок, валидация файлов и Telegram-уведомления.

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

const ALLOWED_ORIGINS = [
  'https://kobnuhok.github.io',
  'https://ooofedstroy.ru',
  'http://localhost:8080',
  'http://localhost:3000'
];
app.use(cors({
  origin: (origin, cb) => {
    // Разрешаем запросы без origin (curl, Postman, server-to-server) и известные origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} не разрешён`));
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'leads.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

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

// Атомарное сохранение заявки в leads.json
function saveLead(newLead) {
  let leads = [];
  if (fs.existsSync(DATA_FILE)) {
    const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (content) {
      // Если файл повреждён — бросаем ошибку, не перезаписываем данные
      leads = JSON.parse(content);
    }
  }

  leads.unshift(newLead);
  const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
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

// Отправка уведомления в Telegram (при наличии токена и ID чата в .env)
async function sendToTelegram(lead, file) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const text = [
      `🏗 *Новая заявка с сайта ООО «ФЕДСТРОЙ»*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📋 *Номер расчетного листа:* \`${lead.leadId}\``,
      `👤 *Клиент:* ${lead.name || 'Не указано'}`,
      `📞 *Телефон:* ${lead.phone}`,
      lead.service ? `⚙️ *Услуга:* ${lead.service}` : null,
      lead.area ? `📐 *Площадь:* ${lead.area} м²` : null,
      lead.building ? `🏢 *Тип объекта:* ${lead.building}` : null,
      lead.source ? `📌 *Источник:* ${lead.source}` : null,
      lead.comment ? `💬 *Комментарий:* ${lead.comment}` : null,
      file ? `📎 *Прикреплен файл ТЗ:* ${file.originalName} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : null,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`
    ].filter(Boolean).join('\n');

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });

    if (file && fs.existsSync(file.path)) {
      const fileData = fs.readFileSync(file.path);
      const blob = new Blob([fileData]);
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', blob, Buffer.from(file.originalName, 'latin1').toString('utf8'));
      formData.append('caption', `ТЗ к заявке ${lead.leadId} от ${lead.name || lead.phone}`);

      await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        body: formData
      });
    }
  } catch (err) {
    console.error('[telegram:notify:error]', err.message);
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

app.post('/api/lead', (req, res, next) => {
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
    sendToTelegram(newLead, newLead.file);

    return res.status(200).json({
      success: true,
      leadId,
      message: 'Заявка зарегистрирована. Инженер ПТО получит уведомление.'
    });
  } catch (err) {
    console.error('[lead:process:error]', err);
    return res.status(500).json({
      success: false,
      error: 'Произошла ошибка при обработке заявки на сервере. Пожалуйста, позвоните нам по номеру 8 (800) 700-02-23.'
    });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
});
