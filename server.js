// =========================================================================
// Сервер ООО «ФЕДСТРОЙ» — Обработка заявок, загрузка ТЗ и Telegram-бот
// =========================================================================

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Разрешаем CORS для отправки с GitHub Pages и локального хоста
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Директории для загрузок и данных
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'leads.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// Настройка хранилища Multer для файлов ТЗ
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');
    const timestamp = Date.now();
    cb(null, `${timestamp}_${base}${ext}`);
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
      cb(new Error('Недопустимый формат файла. Разрешены: .dwg, .pdf, .zip, .rar, .doc, .xls, .png, .jpg'));
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
      file ? `📎 *Прикреплен файл ТЗ:* ${file.originalname} (${(file.size / (1024 * 1024)).toFixed(2)} МБ)` : null,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`
    ].filter(Boolean).join('\n');

    // 1. Отправляем текстовое сообщение
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });

    // 2. Если есть прикрепленный файл ТЗ — отправляем документ
    if (file && fs.existsSync(file.path)) {
      const fileData = fs.readFileSync(file.path);
      const blob = new Blob([fileData]);
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', blob, Buffer.from(file.originalname, 'latin1').toString('utf8'));
      formData.append('caption', `ТЗ к заявке ${lead.leadId} от ${lead.name || lead.phone}`);

      await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        body: formData
      });
    }
  } catch (err) {
    console.error('[Telegram Notify Error]:', err.message);
  }
}

// Эндпоинт проверки работоспособности
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ООО «ФЕДСТРОЙ» API',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Эндпоинт приема заявок (поддерживает multipart/form-data и application/json)
app.post('/api/lead', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, error: `Ошибка загрузки файла: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { name, phone, service, area, building, comment, source } = req.body;
    const attachedFile = (req.files && req.files.length > 0) ? req.files[0] : null;

    // Валидация телефона
    const phoneClean = (phone || '').replace(/\D/g, '');
    if (phoneClean.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Пожалуйста, укажите корректный контактный номер телефона (не менее 10 цифр).'
      });
    }

    // Генерация официального номера расчета
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const leadId = `ФС-${randomCode}`;

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
        size: attachedFile.size
      } : null
    };

    // Сохранение заявки в базу leads.json
    try {
      const currentLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]');
      currentLeads.unshift(newLead);
      fs.writeFileSync(DATA_FILE, JSON.stringify(currentLeads, null, 2), 'utf8');
    } catch (saveErr) {
      console.error('[Database Save Error]:', saveErr.message);
    }

    // Асинхронная отправка в Telegram
    sendToTelegram(newLead, attachedFile);

    console.log(`[Новая заявка ${leadId}] Клиент: ${newLead.name || 'Без имени'}, Тел: ${newLead.phone}, Файл: ${newLead.file ? newLead.file.originalName : 'нет'}`);

    return res.status(200).json({
      success: true,
      leadId,
      message: 'Заявка успешно зарегистрирована и передана инженеру ПТО.'
    });
  } catch (err) {
    console.error('[Lead Process Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Произошла ошибка при обработке заявки на сервере. Пожалуйста, позвоните нам по номеру 8 (800) 700-02-23.'
    });
  }
});

// Раздача статических файлов сайта
app.use(express.static(__dirname));

// Запуск сервера
app.listen(PORT, () => {
  console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
  console.log(`[API Эндпоинт] POST http://localhost:${PORT}/api/lead`);
});
