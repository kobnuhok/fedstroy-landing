// Скрипт проверки реальных каналов уведомлений (Telegram Bot API и Yandex SMTP)
// Режимы:
//   node scripts/live-notification-smoke.js
//     -> строгая проверка наличия учетных данных и соединения (getMe + transporter.verify)
//     -> при отсутствии ключей или ошибке сети возвращает код 1 (FAIL)
//   node scripts/live-notification-smoke.js --send
//     -> реальная отправка тестового письма и Telegram-сообщения
//     -> при ошибке доставки возвращает код 1 (FAIL)
//   node scripts/live-notification-smoke.js --allow-unreachable-telegram
//     -> разрешает игнорировать сетевую недоступность api.telegram.org (для локальных ПК в РФ без VPN)

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

// Загрузка переменных из .env (если файл существует)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const shouldSend = process.argv.includes('--send');
const allowUnreachableTelegram = process.argv.includes('--allow-unreachable-telegram');

console.log('\n======================================================');
console.log('  LIVE SMOKE-ТЕСТ КАНАЛОВ УВЕДОМЛЕНИЙ (Telegram & SMTP)');
console.log(`  Режим отправки тестового сообщения: ${shouldSend ? 'ВКЛЮЧЕН (--send)' : 'ОТКЛЮЧЕН (только верификация соединения)'}`);
if (allowUnreachableTelegram) {
  console.log('  Сетевые сбои Telegram: РАЗРЕШЕНЫ (--allow-unreachable-telegram)');
}
console.log('======================================================\n');

// Запрос к Telegram API с поддержкой локального прокси и контролем таймаута
function requestTelegram(apiPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve) => {
    // 1. Попытка через локальный туннель/прокси
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: 10808,
      method: 'CONNECT',
      path: 'api.telegram.org:443',
      timeout: 1000
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
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
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
        timeout: 4000
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
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Таймаут соединения с api.telegram.org (блокировка провайдером в РФ)' });
      });
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

async function testTelegram() {
  console.log('▶ [1/2] Проверка Telegram Bot API...');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.error('  [FAIL] TELEGRAM_BOT_TOKEN не задан в .env или переменных окружения');
    return false;
  }

  // 1. Проверка валидности токена через getMe
  console.log('  [INFO] Запрос к Telegram Bot API (getMe)...');
  const meResult = await requestTelegram(`/bot${token}/getMe`, 'GET');

  if (!meResult.ok || !meResult.data?.ok) {
    const errMsg = meResult.error || meResult.data?.description || 'Неизвестная ошибка';
    if (allowUnreachableTelegram) {
      console.warn(`  [WARN] Telegram API недоступен (${errMsg}), но пропущен флагом --allow-unreachable-telegram`);
      return true;
    }
    console.error(`  [FAIL] Ошибка проверки Telegram Bot API: ${errMsg}`);
    return false;
  }

  const botUser = meResult.data.result.username;
  console.log(`  [PASS] Бот авторизован успешно: @${botUser} (ID: ${meResult.data.result.id})`);

  // 2. Если включен флаг --send
  if (shouldSend) {
    if (!chatId) {
      console.error('  [FAIL] TELEGRAM_CHAT_ID не задан в .env — отправка тестового сообщения невозможна');
      return false;
    }

    console.log(`  [INFO] Отправка тестового сообщения в чат ${chatId}...`);
    const sendBody = JSON.stringify({
      chat_id: String(chatId).trim(),
      text: `🧪 <b>Live Smoke Test</b>\nСервер: ООО «ФЕДСТРОЙ»\nВремя: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)\nСтатус: <b>Все системы в норме ✅</b>`,
      parse_mode: 'HTML'
    });

    const sendRes = await requestTelegram(`/bot${token}/sendMessage`, 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(sendBody)
    }, sendBody);

    if (sendRes.ok && sendRes.data?.ok) {
      console.log(`  [PASS] Тестовое сообщение доставлено в Telegram! Message ID: ${sendRes.data.result.message_id}`);
    } else {
      const sendErr = sendRes.data?.description || sendRes.error || 'Ошибка отправки';
      if (allowUnreachableTelegram) {
        console.warn(`  [WARN] Ошибка отправки в Telegram (${sendErr}), пропущена флагом --allow-unreachable-telegram`);
        return true;
      }
      console.error(`  [FAIL] Не удалось отправить сообщение в Telegram: ${sendErr}`);
      return false;
    }
  }

  return true;
}

async function testSmtp() {
  console.log('\n▶ [2/2] Проверка корпоративной почты (Yandex SMTP)...');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || 'smtp.yandex.ru';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false';
  const emailTo = process.env.EMAIL_TO || 'kobnuhok@yandex.ru';

  if (!user || !pass) {
    console.error('  [FAIL] SMTP_USER или SMTP_PASS не заданы в .env или переменных окружения');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  try {
    console.log(`  [INFO] Подключение к ${host}:${port} (TLS: ${secure}, логин: ${user})...`);
    await transporter.verify();
    console.log(`  [PASS] SMTP-сервер подтвердил подлинность учетных данных (transporter.verify: OK)`);

    if (shouldSend) {
      console.log(`  [INFO] Отправка тестового письма на ${emailTo}...`);
      const info = await transporter.sendMail({
        from: `"ООО «ФЕДСТРОЙ»" <${user}>`,
        to: emailTo,
        subject: `🧪 [ТЕСТ] Проверка почтового шлюза ООО «ФЕДСТРОЙ»`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px;">
            <h2 style="color: #0f172a; margin-top: 0;">🧪 Live Smoke Test почтового шлюза</h2>
            <p>Тест выполнен успешно. Шлюз готов к приему и доставке клиентских заявок.</p>
            <p style="color: #64748b; font-size: 13px;">Отправлено: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)</p>
          </div>
        `
      });
      console.log(`  [PASS] Тестовое письмо успешно доставлено на ${emailTo}! (Message ID: ${info.messageId})`);
    }
    return true;
  } catch (err) {
    console.error(`  [FAIL] Ошибка SMTP: ${err.message}`);
    return false;
  }
}

async function main() {
  const tgOk = await testTelegram();
  const smtpOk = await testSmtp();

  console.log('\n======================================================');
  if (tgOk && smtpOk) {
    console.log('  ИТОГ: Все проверенные каналы уведомлений исправны! ✅');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error('  ИТОГ: Обнаружены проблемы с каналами уведомлений! ❌');
    console.log('======================================================\n');
    process.exit(1);
  }
}

main();
