// Набор сквозных тестов API и граничных сценариев
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function runTestSuite() {
  console.log('=== Запуск тестового сценария API и валидации ===\n');

  // Запуск сервера в дочернем процессе
  const serverProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, PORT: '8899' }
  });

  // Ожидание старта сервера
  await new Promise((resolve, reject) => {
    serverProc.stdout.on('data', d => {
      if (d.toString().includes('Сервер запущен')) resolve();
    });
    serverProc.stderr.on('data', d => console.error('[server stderr]', d.toString()));
    serverProc.on('error', reject);
  });

  const BASE_URL = 'http://localhost:8899';
  let passed = 0;
  let failed = 0;

  async function testCase(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  try {
    // 1. Позитивный сценарий: полный запрос с валидным DWG-файлом
    await testCase('1. Позитивный: валидный телефон + имя + файл .dwg', async () => {
      const fd = new FormData();
      fd.append('name', 'Инженер Тестов');
      fd.append('phone', '+7 (916) 123-45-67');
      fd.append('service', 'Вентфасад');
      const dwgBlob = new Blob(['sample-dwg-binary-data'], { type: 'application/octet-stream' });
      fd.append('attachment', dwgBlob, 'test_drawing.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 200) throw new Error(`Ожидался статус 200, получен ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.leadId || !json.leadId.startsWith('ФС-')) {
        throw new Error(`Некорректный ответ: ${JSON.stringify(json)}`);
      }
    });

    // 2. Негативный: пустой телефон
    await testCase('2. Негативный: пустой номер телефона', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент');
      fd.append('phone', '');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался статус 400, получен ${res.status}`);
      const json = await res.json();
      if (json.success !== false) throw new Error('Ожидался success: false');
    });

    // 3. Негативный: некорректный телефон (менее 10 цифр)
    await testCase('3. Негативный: короткий телефон (12345)', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент');
      fd.append('phone', '12345');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался статус 400, получен ${res.status}`);
    });

    // 4. Негативный: нероссийский номер (не начинается на 7, 8 или 9)
    await testCase('4. Негативный: недопустимый префикс телефона', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент');
      fd.append('phone', '+1 (234) 567-89-01');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался статус 400, получен ${res.status}`);
    });

    // 5. Негативный: запрещенное расширение файла (.exe)
    await testCase('5. Негативный: запрещенное расширение файла (.exe)', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент');
      fd.append('phone', '+7 (999) 000-11-22');
      const exeBlob = new Blob(['MZ-binary-header'], { type: 'application/x-msdownload' });
      fd.append('attachment', exeBlob, 'malware.exe');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался статус 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('Недопустимый формат')) {
        throw new Error(`Ожидалось сообщение о формате, получено: ${json.error}`);
      }
    });

    // 6. Негативный: пустой файл (0 байт)
    await testCase('6. Негативный: файл размером 0 байт', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент');
      fd.append('phone', '+7 (999) 000-11-22');
      const emptyBlob = new Blob([], { type: 'application/pdf' });
      fd.append('attachment', emptyBlob, 'empty.pdf');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался статус 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('0 байт')) {
        throw new Error(`Ожидалось сообщение о 0 байт, получено: ${json.error}`);
      }
    });

    // 7. Проверка CORS для GitHub Pages origin
    await testCase('7. CORS: заголовок Origin https://kobnuhok.github.io', async () => {
      const res = await fetch(`${BASE_URL}/api/health`, {
        headers: { 'Origin': 'https://kobnuhok.github.io' }
      });
      const acao = res.headers.get('access-control-allow-origin');
      if (acao !== '*' && acao !== 'https://kobnuhok.github.io') {
        throw new Error(`Некорректный CORS заголовок: ${acao}`);
      }
    });

  } finally {
    serverProc.kill();
    // Очистка тестовых данных
    const dataPath = path.resolve(__dirname, '..', 'data', 'leads.json');
    if (fs.existsSync(dataPath)) fs.writeFileSync(dataPath, '[]\n');
    const uploadsDir = path.resolve(__dirname, '..', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.readdirSync(uploadsDir).forEach(f => {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (_) {}
      });
    }
  }

  console.log(`\n=== Результаты: ${passed} пройдено, ${failed} провалено ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite();
