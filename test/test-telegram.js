require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// Умный запрос: пробует локальный туннель 10808 (если есть), иначе напрямую
function requestTelegram(apiPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    // 1. Проверяем локальный туннель 10808 (для обхода блокировки в РФ)
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
            resolve(JSON.parse(raw));
          } catch {
            resolve({ ok: false, description: raw });
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
            resolve(JSON.parse(raw));
          } catch {
            resolve({ ok: false, description: raw });
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

async function runTelegramTest() {
  console.log('--- 1. Проверка учетных данных ---');
  if (!token) {
    console.error('FAIL: TELEGRAM_BOT_TOKEN не задан в .env');
    process.exit(1);
  }
  if (!chatId) {
    console.error('FAIL: TELEGRAM_CHAT_ID не задан в .env');
    process.exit(1);
  }
  console.log('TELEGRAM_BOT_TOKEN: задан (длина:', token.length, ')');
  console.log('TELEGRAM_CHAT_ID:', chatId);

  console.log('\n--- 2. Проверка доступности бота (getMe) ---');
  try {
    const meData = await requestTelegram(`/bot${token}/getMe`);
    if (!meData.ok) {
      console.error('FAIL getMe:', meData);
      process.exit(1);
    }
    console.log('SUCCESS: Бот авторизован: @' + meData.result.username + ' («' + meData.result.first_name + '»)');
  } catch (err) {
    console.error('FAIL network getMe:', err.message);
    process.exit(1);
  }

  console.log('\n--- 3. Отправка тестового сообщения в группу ---');
  const leadId = 'ФС-' + Math.floor(1000 + Math.random() * 9000);
  const text = [
    `<b>🏗 Новая заявка с сайта ООО «ФЕДСТРОЙ»</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>📋 Номер расчетного листа:</b> <code>${leadId}</code>`,
    `<b>👤 Клиент:</b> Александр (Тестовый запуск)`,
    `<b>📞 Телефон:</b> +7 (999) 000-00-00`,
    `<b>⚙️ Услуга:</b> Вентилируемый фасад (НВФ)`,
    `<b>📐 Площадь:</b> 1 500 м²`,
    `<b>🏢 Тип объекта:</b> ТРЦ / Торговый центр`,
    `<b>📌 Источник:</b> Калькулятор (прогон интеграционного теста)`,
    `<b>💬 Комментарий:</b> Тест интеграции Telegram-бота и группы инженеров ПТО`,
    `<b>📎 Прикреплен файл ТЗ:</b> test_project.dwg (0.10 МБ)`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`
  ].join('\n');

  try {
    const msgBody = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    });
    const sendData = await requestTelegram(`/bot${token}/sendMessage`, 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgBody)
    }, msgBody);

    if (!sendData.ok) {
      console.error('FAIL sendMessage:', sendData);
      process.exit(1);
    }
    console.log('SUCCESS: Сообщение успешно доставлено в группу! Message ID:', sendData.result.message_id);

    console.log('\n--- 4. Тестовая отправка файла проекта (sendDocument) ---');
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const dummyContent = 'AC1032-AUTOCAD-TEST-PROJECT-DRAWING-FEDSTROY';
    const formBuffers = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nТЗ к заявке ${leadId} от Александр (+7 (999) 000-00-00)\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="АР_фасад_секция1.dwg"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(dummyContent),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    const postData = Buffer.concat(formBuffers);

    const docData = await requestTelegram(`/bot${token}/sendDocument`, 'POST', {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': postData.length
    }, postData);

    if (!docData.ok) {
      console.error('FAIL sendDocument:', docData);
      process.exit(1);
    }
    console.log('SUCCESS: Чертеж успешно прикреплен и доставлен в Telegram! Doc Message ID:', docData.result.message_id);

    console.log('\n=== ИТОГ: Все проверки пройдены на 100%! Бот и группа готовы к приему реальных заявок ===');
  } catch (err) {
    console.error('FAIL network:', err.message);
    process.exit(1);
  }
}

runTelegramTest();
