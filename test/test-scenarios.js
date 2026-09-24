// Комплексный набор тестов границ надежности и безопасности API
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_TMP_DIR = path.join(__dirname, '.tmp');
const TEST_DATA_DIR = path.join(TEST_TMP_DIR, 'data');
const TEST_UPLOADS_DIR = path.join(TEST_TMP_DIR, 'uploads');
const DATA_FILE = path.join(TEST_DATA_DIR, 'leads.json');
const UPLOADS_DIR = TEST_UPLOADS_DIR;
const TEST_PORT = 8991;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function startServer(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['server.js'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        DATA_DIR: TEST_DATA_DIR,
        UPLOADS_DIR: TEST_UPLOADS_DIR,
        KEEP_UPLOADED_FILES: 'true'
      }
    });

    proc.stdout.on('data', d => {
      if (d.toString().includes('Сервер запущен')) resolve(proc);
    });
    proc.stderr.on('data', d => {
      // Игнорируем логи инъекции env
      if (!d.toString().includes('injected env')) {
        console.error('[server stderr]', d.toString());
      }
    });
    proc.on('error', reject);
  });
}

function cleanTestData() {
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  if (!fs.existsSync(TEST_UPLOADS_DIR)) fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, '[]\n');
  if (fs.existsSync(TEST_UPLOADS_DIR)) {
    fs.readdirSync(TEST_UPLOADS_DIR).forEach(f => {
      try { fs.unlinkSync(path.join(TEST_UPLOADS_DIR, f)); } catch (_) {}
    });
  }
}

async function runAllTests() {
  console.log('=== Запуск расширенного тестирования граничных условий ===\n');
  cleanTestData();

  let serverProc = await startServer(TEST_PORT);
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
    // -------------------------------------------------------------
    // БЛОК 1: Границы размера файла
    // -------------------------------------------------------------
    await testCase('1.1. Размер: 1 байт (допустимо)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест 1 байт');
      fd.append('phone', '+7 (916) 111-22-33');
      fd.append('agreement', 'on');
      const b = new Blob(['A'], { type: 'application/octet-stream' });
      fd.append('attachment', b, 'min.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.leadId) throw new Error('Некорректный ответ');
    });

    await testCase('1.2. Размер: нормальный файл проекта (100 КБ)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест нормальный');
      fd.append('phone', '+7 (916) 222-33-44');
      fd.append('agreement', 'on');
      const b = new Blob([Buffer.alloc(100 * 1024, 0x20)], { type: 'application/octet-stream' });
      fd.append('attachment', b, 'drawing_standard.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    });

    await testCase('1.3. Размер: ровно 35 МБ (граница — допустимо)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест граница 35МБ');
      fd.append('phone', '+7 (916) 333-44-55');
      fd.append('agreement', 'on');
      const exactLimit = new Blob([Buffer.alloc(35 * 1024 * 1024, 0x20)], { type: 'application/octet-stream' });
      fd.append('attachment', exactLimit, 'exact_limit.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 200) throw new Error(`Ожидался 200 (ровно лимит), получен ${res.status}`);
    });

    await testCase('1.4. Размер: 35 МБ + 1 байт (граница + 1 — должен отклонить)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест граница + 1 байт');
      fd.append('phone', '+7 (916) 344-55-66');
      fd.append('agreement', 'on');
      const overLimit = new Blob([Buffer.alloc(35 * 1024 * 1024 + 1, 0x20)], { type: 'application/octet-stream' });
      fd.append('attachment', overLimit, 'over_limit.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400 (лимит + 1 байт), получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('35 МБ')) {
        throw new Error(`Ожидалось сообщение о 35 МБ: ${json.error}`);
      }
    });

    await testCase('1.5. Размер: 100 МБ (существенно больше лимита)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест 100МБ');
      fd.append('phone', '+7 (916) 355-66-77');
      fd.append('agreement', 'on');
      const hugeBlob = new Blob([Buffer.alloc(100 * 1024 * 1024, 0x00)], { type: 'application/octet-stream' });
      fd.append('attachment', hugeBlob, 'huge_model.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('35 МБ')) {
        throw new Error(`Ожидалось сообщение о 35 МБ: ${json.error}`);
      }
    });

    // -------------------------------------------------------------
    // БЛОК 2: Подмена расширения (Magic Bytes validation)
    // -------------------------------------------------------------
    await testCase('2.1. Безопасность: исполняемый .exe под видом .dwg (сигнатура MZ)', async () => {
      const fd = new FormData();
      fd.append('name', 'Злоумышленник');
      fd.append('phone', '+7 (916) 444-55-66');
      fd.append('agreement', 'on');
      // Заголовок Windows PE executable: 'MZ' (0x4D, 0x5A)
      const fakeExe = new Blob([Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])], { type: 'application/octet-stream' });
      fd.append('attachment', fakeExe, 'trojan.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400 (отклонено), получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('исполняемый файл')) {
        throw new Error(`Ожидалось предупреждение об исполняемом файле: ${json.error}`);
      }
    });

    await testCase('2.2. Безопасность: фальшивый .pdf с бинарным мусором вместо %PDF', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест PDF сигнатуры');
      fd.append('phone', '+7 (916) 555-66-77');
      fd.append('agreement', 'on');
      const badPdf = new Blob([Buffer.from('НЕ_PDF_ДАННЫЕ_12345')], { type: 'application/pdf' });
      fd.append('attachment', badPdf, 'corrupted.pdf');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('PDF')) {
        throw new Error(`Ожидалось сообщение о PDF: ${json.error}`);
      }
    });

    await testCase('2.3. Безопасность: 1-байтный .pdf файл отклоняется как невалидный PDF', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест 1-байт PDF');
      fd.append('phone', '+7 (916) 555-66-77');
      fd.append('agreement', 'on');
      const badPdf = new Blob([Buffer.from('%')], { type: 'application/pdf' });
      fd.append('attachment', badPdf, 'tiny.pdf');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.toLowerCase().includes('pdf')) {
        throw new Error(`Ожидалось сообщение о PDF: ${json.error}`);
      }
    });

    // -------------------------------------------------------------
    // БЛОК 3: Повторная отправка и защита от перезаписи файлов
    // -------------------------------------------------------------
    await testCase('3.1. Параллельная отправка: 2 заявки с одинаковым именем файла', async () => {
      const makeReq = async (name) => {
        const fd = new FormData();
        fd.append('name', name);
        fd.append('phone', '+7 (916) 777-88-99');
        fd.append('agreement', 'on');
        const b = new Blob([Buffer.from(`file content for ${name}`)], { type: 'application/octet-stream' });
        fd.append('attachment', b, 'facade.dwg');
        const r = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
        return r.json();
      };

      const [res1, res2] = await Promise.all([makeReq('Заявка 1'), makeReq('Заявка 2')]);
      if (res1.leadId === res2.leadId) throw new Error('Одинаковые leadId у разных заявок');

      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const lead1 = leads.find(l => l.leadId === res1.leadId);
      const lead2 = leads.find(l => l.leadId === res2.leadId);

      if (!lead1 || !lead2) throw new Error('Заявки не найдены в leads.json');
      if (lead1.file.filename === lead2.file.filename) {
        throw new Error('Коллизия имени сохраненного файла в uploads/');
      }
      const path1 = path.join(UPLOADS_DIR, lead1.file.filename);
      const path2 = path.join(UPLOADS_DIR, lead2.file.filename);
      if (!fs.existsSync(path1) || !fs.existsSync(path2)) {
        throw new Error('Один из файлов не найден на диске в UPLOADS_DIR');
      }
    });

    // -------------------------------------------------------------
    // БЛОК 4: Перезапуск сервера и сохранность данных
    // -------------------------------------------------------------
    await testCase('4.1. Персистентность: сохранение заявок после перезапуска сервера', async () => {
      // Отправляем заявку А
      const fdA = new FormData();
      fdA.append('name', 'Клиент До Перезапуска');
      fdA.append('phone', '+7 (916) 100-20-30');
      fdA.append('agreement', 'on');
      const resA = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fdA });
      const jsonA = await resA.json();

      // Перезапускаем сервер
      serverProc.kill();
      await new Promise(r => setTimeout(r, 500));
      serverProc = await startServer(TEST_PORT);

      // Проверяем leads.json сразу после рестарта
      let leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!leads.some(l => l.leadId === jsonA.leadId)) {
        throw new Error('Заявка утеряна после перезапуска сервера!');
      }

      // Отправляем заявку Б
      const fdB = new FormData();
      fdB.append('name', 'Клиент После Перезапуска');
      fdB.append('phone', '+7 (916) 200-30-40');
      fdB.append('agreement', 'on');
      const resB = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fdB });
      const jsonB = await resB.json();

      // Проверяем, что обе заявки на месте и JSON валиден
      leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const hasA = leads.some(l => l.leadId === jsonA.leadId);
      const hasB = leads.some(l => l.leadId === jsonB.leadId);
      if (!hasA || !hasB) throw new Error('Одна из заявок отсутствует в leads.json');
    });

    // -------------------------------------------------------------
    // БЛОК 5: Проверка валидации телефонов и пустых файлов
    // -------------------------------------------------------------
    await testCase('5.1. Пустой файл 0 байт -> отклонен (400)', async () => {
      const fd = new FormData();
      fd.append('name', 'Ноль байт');
      fd.append('phone', '+7 (916) 300-40-50');
      fd.append('agreement', 'on');
      fd.append('attachment', new Blob([], { type: 'application/octet-stream' }), 'zero.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`HTTP ${res.status}`);
    });

    // -------------------------------------------------------------
    // БЛОК 6: Проверка согласия с обработкой ПД (152-ФЗ) и готовности хранилища
    // -------------------------------------------------------------
    await testCase('6.1. Согласие с ПД: валидный телефон, но согласие отсутствует -> 400', async () => {
      const fd = new FormData();
      fd.append('name', 'Без согласия');
      fd.append('phone', '+7 (916) 400-50-60');
      // agreement намеренно не передается

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('согласие')) {
        throw new Error(`Ожидалась ошибка отсутствия согласия: ${json.error}`);
      }
    });

    await testCase('6.2. Проверка состояния файлового хранилища в /api/health', async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status !== 200) throw new Error(`Ожидался 200, получен ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(`Ожидался status ok: ${json.status}`);
      if (!json.storage || json.storage.ok !== true) {
        throw new Error(`Хранилище не подтверждено: ${JSON.stringify(json.storage)}`);
      }
    });

    await testCase('6.3. Проверка /api/health при сбое хранилища -> 503 degraded', async () => {
      // Временно удаляем leads.json для симуляции сбоя доступности хранилища
      if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);

      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.status !== 503) throw new Error(`Ожидался статус 503 при сбое хранилища, получен ${res.status}`);
        const json = await res.json();
        if (json.status !== 'degraded') throw new Error(`Ожидался status 'degraded', получен '${json.status}'`);
        if (!json.storage || json.storage.ok !== false) {
          throw new Error(`Ожидался storage.ok === false: ${JSON.stringify(json.storage)}`);
        }
      } finally {
        // Восстанавливаем leads.json
        fs.writeFileSync(DATA_FILE, '[]\n');
      }
    });

    await testCase('6.4. Проверка статуса email-уведомлений в /api/health и дублирования в /api/lead', async () => {
      const healthRes = await fetch(`${BASE_URL}/api/health`);
      const healthJson = await healthRes.json();
      if (!healthJson.notifications || healthJson.notifications.emailRecipient !== 'kobnuhok@yandex.ru') {
        throw new Error(`Некорректный статус notifications в health: ${JSON.stringify(healthJson.notifications)}`);
      }

      const fd = new FormData();
      fd.append('name', 'Тест Почты');
      fd.append('phone', '+7 (916) 777-88-99');
      fd.append('agreement', 'on');
      const b = new Blob(['dwg content'], { type: 'application/octet-stream' });
      fd.append('attachment', b, 'plan_email.dwg');

      const leadRes = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (leadRes.status !== 200) throw new Error(`Ожидался 200, получен ${leadRes.status}`);
      const leadJson = await leadRes.json();
      if (!leadJson.email || leadJson.email.sent !== true || leadJson.email.recipient !== 'kobnuhok@yandex.ru') {
        throw new Error(`Ожидалось успешное дублирование на email: ${JSON.stringify(leadJson.email)}`);
      }
    });

    await testCase('6.5. Защита от утечки данных: запрет прямого доступа к data/, uploads/ и служебным файлам', async () => {
      const endpoints = [
        '/data/leads.json',
        '/uploads/',
        '/server.js',
        '/package.json',
        '/package-lock.json',
        '/ecosystem.config.js',
        '/.env'
      ];

      for (const ep of endpoints) {
        const res = await fetch(`${BASE_URL}${ep}`);
        if (res.status !== 404) {
          throw new Error(`Утечка данных! ${ep} вернул HTTP ${res.status}, ожидался 404 Not Found`);
        }
      }
    });

  } finally {
    serverProc.kill();
    cleanTestData();
    if (fs.existsSync(TEST_TMP_DIR)) {
      try { fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true }); } catch (_) {}
    }
  }

  console.log(`\n=== Итого: ${passed} пройдено, ${failed} провалено ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
