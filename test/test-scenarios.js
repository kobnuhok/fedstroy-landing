// Комплексный набор тестов границ надежности и безопасности API
process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_TMP_DIR = path.join(__dirname, '.tmp');
const TEST_DATA_DIR = path.join(TEST_TMP_DIR, 'data');
const TEST_UPLOADS_DIR = path.join(TEST_TMP_DIR, 'uploads');
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
const DATA_FILE = path.join(TEST_DATA_DIR, 'leads.json');
const UPLOADS_DIR = TEST_UPLOADS_DIR;
const TEST_PORT = 8991;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function startServer(port, extraEnv = {}) {
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
        KEEP_UPLOADED_FILES: 'true',
        ...extraEnv
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

    await testCase('6.1b. Валидация: пустое имя контактного лица -> 400', async () => {
      const fd = new FormData();
      fd.append('name', '   '); // пустое имя из пробелов
      fd.append('phone', '+7 (916) 400-50-60');
      fd.append('agreement', 'on');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('имя')) {
        throw new Error(`Ожидалась ошибка отсутствия имени: ${json.error}`);
      }
    });

    await testCase('6.1c. Валидация: превышение лимитов длины полей (комментарий > 5000 символов) -> 400', async () => {
      const fd = new FormData();
      fd.append('name', 'Клиент с длинным комментарием');
      fd.append('phone', '+7 (916) 400-50-60');
      fd.append('agreement', 'on');
      fd.append('comment', 'A'.repeat(5001));

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 400) throw new Error(`Ожидался 400, получен ${res.status}`);
      const json = await res.json();
      if (!json.error || !json.error.includes('5000')) {
        throw new Error(`Ожидалась ошибка превышения лимита комментария: ${json.error}`);
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

    await testCase('6.3b. Проверка /api/health при поврежденном JSON в leads.json -> 503 degraded', async () => {
      // Записываем битый JSON в leads.json
      fs.writeFileSync(DATA_FILE, 'НЕВАЛИДНЫЙ_JSON_{{{');

      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.status !== 503) throw new Error(`Ожидался статус 503 при битом leads.json, получен ${res.status}`);
        const json = await res.json();
        if (json.status !== 'degraded') throw new Error(`Ожидался status 'degraded', получен '${json.status}'`);
        if (!json.storage || json.storage.ok !== false) {
          throw new Error(`Ожидался storage.ok === false: ${JSON.stringify(json.storage)}`);
        }
      } finally {
        fs.writeFileSync(DATA_FILE, '[]\n');
      }
    });

    await testCase('6.3c. Проверка /api/health при leads.json не являющимся массивом ({}) -> 503 degraded', async () => {
      // Записываем валидный JSON-объект, но не массив
      fs.writeFileSync(DATA_FILE, '{"corrupted": true}');

      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.status !== 503) throw new Error(`Ожидался статус 503 при не-массиве в leads.json, получен ${res.status}`);
        const json = await res.json();
        if (json.status !== 'degraded') throw new Error(`Ожидался status 'degraded', получен '${json.status}'`);
        if (!json.storage || json.storage.ok !== false) {
          throw new Error(`Ожидался storage.ok === false: ${JSON.stringify(json.storage)}`);
        }
      } finally {
        fs.writeFileSync(DATA_FILE, '[]\n');
      }
    });

    await testCase('6.3d. Проверка /api/health при пустом leads.json ("") -> 503 degraded и отказ сохранения', async () => {
      // Записываем пустую строку в leads.json
      fs.writeFileSync(DATA_FILE, '');

      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.status !== 503) throw new Error(`Ожидался статус 503 при пустом leads.json, получен ${res.status}`);
        const json = await res.json();
        if (json.status !== 'degraded') throw new Error(`Ожидался status 'degraded', получен '${json.status}'`);
        if (!json.storage || json.storage.ok !== false) {
          throw new Error(`Ожидался storage.ok === false: ${JSON.stringify(json.storage)}`);
        }

        // Попытка сохранения новой заявки при пустом/поврежденном файле не должна затирать данные
        const leadFd = new FormData();
        leadFd.append('name', 'Тест защиты от перезаписи');
        leadFd.append('phone', '+7 (916) 999-00-11');
        leadFd.append('agreement', 'on');
        const postRes = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: leadFd });
        if (postRes.status !== 500) throw new Error(`Ожидался 500 при сохранении в пустой leads.json, получен ${postRes.status}`);
      } finally {
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
      if (leadJson.email.attached !== true) {
        throw new Error(`Ожидалось прикрепление файла <= 20 МБ: ${JSON.stringify(leadJson.email)}`);
      }
    });

    await testCase('6.4b. Политика размера вложений: файл 25 МБ принимается сервером, но опускается в email (лимит Яндекс 30 МБ)', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест Большого Файла 25МБ');
      fd.append('phone', '+7 (916) 777-88-99');
      fd.append('agreement', 'on');
      // 25 МБ чертеж: допустим для сервера (< 35 МБ), но больше email-лимита (20 МБ)
      const bigBlob = new Blob([Buffer.alloc(25 * 1024 * 1024, 0x00)], { type: 'application/octet-stream' });
      fd.append('attachment', bigBlob, 'large_facade_model.dwg');

      const leadRes = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (leadRes.status !== 200) throw new Error(`Ожидался 200 для 25 МБ файла, получен ${leadRes.status}`);
      const leadJson = await leadRes.json();
      if (!leadJson.email || leadJson.email.sent !== true) {
        throw new Error(`Ожидалась успешная отправка email без вложения: ${JSON.stringify(leadJson.email)}`);
      }
      if (leadJson.email.attached !== false) {
        throw new Error(`Вложение 25 МБ не должно прикрепляться к email: ${JSON.stringify(leadJson.email)}`);
      }
      if (leadJson.email.oversized !== true) {
        throw new Error(`Ожидался флаг oversized === true: ${JSON.stringify(leadJson.email)}`);
      }

      // Проверяем, что заявка сохранена в leads.json
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const savedLead = leads.find(l => l.leadId === leadJson.leadId);
      if (!savedLead) throw new Error(`Заявка ${leadJson.leadId} не найдена в leads.json`);
      if (savedLead.file.size !== 25 * 1024 * 1024) {
        throw new Error(`Неверный размер сохраненного файла: ${savedLead.file.size}`);
      }
    });

    await testCase('6.5. Защита от утечки данных: запрет прямого доступа к data/, uploads/ и служебным файлам', async () => {
      const endpoints = [
        '/data/leads.json',
        '/uploads/',
        '/src/template.html',
        '/src/input.css',
        '/blocks/header.html',
        '/test/test-scenarios.js',
        '/deploy/nginx.conf',
        '/scripts/smoke-leak-test.js',
        '/server.js',
        '/package.json',
        '/package-lock.json',
        '/ecosystem.config.js',
        '/.env',
        '/.env.example',
        '/README.md',
        '/playwright.config.js',
        '/vercel.json'
      ];

      for (const ep of endpoints) {
        const res = await fetch(`${BASE_URL}${ep}`);
        if (res.status !== 404) {
          throw new Error(`Утечка данных! ${ep} вернул HTTP ${res.status}, ожидался 404 Not Found`);
        }
      }
    });

    await testCase('6.6. Детализация Telegram-доставки: флаги messageSent, documentSent и fullyDelivered', async () => {
      // 1. С файлом: messageSent === true, documentSent === true, fullyDelivered === true
      const fdWithFile = new FormData();
      fdWithFile.append('name', 'Тест Telegram статус с файлом');
      fdWithFile.append('phone', '+7 (916) 888-00-11');
      fdWithFile.append('agreement', 'on');
      const b = new Blob(['sample dwg content'], { type: 'application/octet-stream' });
      fdWithFile.append('attachment', b, 'telegram_test.dwg');

      const resWithFile = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fdWithFile });
      if (resWithFile.status !== 200) throw new Error(`HTTP ${resWithFile.status}`);
      const jsonWithFile = await resWithFile.json();
      if (!jsonWithFile.telegram) throw new Error('Отсутствует объект telegram в ответе');
      if (jsonWithFile.telegram.messageSent !== true) throw new Error('Ожидался messageSent === true');
      if (jsonWithFile.telegram.documentSent !== true) throw new Error('Ожидался documentSent === true');
      if (jsonWithFile.telegram.fullyDelivered !== true) throw new Error('Ожидался fullyDelivered === true');

      // 2. Без файла: messageSent === true, documentSent === null, fullyDelivered === true
      const fdNoFile = new FormData();
      fdNoFile.append('name', 'Тест Telegram статус без файла');
      fdNoFile.append('phone', '+7 (916) 888-00-22');
      fdNoFile.append('agreement', 'on');

      const resNoFile = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fdNoFile });
      if (resNoFile.status !== 200) throw new Error(`HTTP ${resNoFile.status}`);
      const jsonNoFile = await resNoFile.json();
      if (jsonNoFile.telegram.messageSent !== true) throw new Error('Ожидался messageSent === true');
      if (jsonNoFile.telegram.documentSent !== null) throw new Error(`Ожидался documentSent === null, получено: ${jsonNoFile.telegram.documentSent}`);
      if (jsonNoFile.telegram.fullyDelivered !== true) throw new Error('Ожидался fullyDelivered === true');
    });

    await testCase('6.7. Персистентность статусов уведомлений: в leads.json сохраняется объект notifications со статусами', async () => {
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const leadWithNotifications = leads.find(l => l.name === 'Тест Telegram статус с файлом');
      if (!leadWithNotifications) throw new Error('Заявка не найдена в leads.json');
      if (!leadWithNotifications.notifications) throw new Error('В заявке отсутствует объект notifications');
      if (leadWithNotifications.notifications.telegram !== 'sent') {
        throw new Error(`Ожидался notifications.telegram === 'sent', получено: ${leadWithNotifications.notifications.telegram}`);
      }
      if (leadWithNotifications.notifications.email !== 'sent') {
        throw new Error(`Ожидался notifications.email === 'sent', получено: ${leadWithNotifications.notifications.email}`);
      }
      if (!leadWithNotifications.notifications.updatedAt) {
        throw new Error('Отсутствует notifications.updatedAt');
      }
    });

    await testCase('6.8. Повторная отправка (retry): заявка со статусами Telegram partial и Email failed повторно обрабатывается и переходит в sent', async () => {
      // 1. Создаем физический файл на диске
      const testFilename = `retry_test_${Date.now()}.dwg`;
      fs.writeFileSync(path.join(TEST_UPLOADS_DIR, testFilename), 'fake dwg for retry test');

      // 2. Добавляем заявку со статусами partial и failed в leads.json
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const retryLeadId = `ФС-TEST-RETRY-${Date.now()}`;
      leads.push({
        leadId: retryLeadId,
        name: 'Клиент Retry Partial Failed',
        phone: '+7 (916) 111-22-33',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'partial',
          email: 'failed',
          attempts: { telegram: 1, email: 1 },
          updatedAt: new Date().toISOString()
        },
        file: {
          originalName: 'retry_file.dwg',
          filename: testFilename,
          size: 1024
        }
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // 3. Запускаем retry
      const retryRes = await fetch(`${BASE_URL}/api/internal/retry`, { method: 'POST' });
      if (retryRes.status !== 200) throw new Error(`HTTP ${retryRes.status}`);

      // 4. Проверяем leads.json: оба канала стали sent, attempts увеличились до 2
      const updatedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const updatedLead = updatedLeads.find(l => l.leadId === retryLeadId);
      if (!updatedLead) throw new Error('Заявка не найдена в leads.json');
      if (updatedLead.notifications.telegram !== 'sent') {
        throw new Error(`Ожидался telegram === 'sent', получено: ${updatedLead.notifications.telegram}`);
      }
      if (updatedLead.notifications.email !== 'sent') {
        throw new Error(`Ожидался email === 'sent', получено: ${updatedLead.notifications.email}`);
      }
      if (updatedLead.notifications.attempts?.telegram !== 2 || updatedLead.notifications.attempts?.email !== 2) {
        throw new Error(`Ожидались attempts === 2: ${JSON.stringify(updatedLead.notifications.attempts)}`);
      }
    });

    await testCase('6.9. Защита от ложного успеха при retry: при отсутствии файла на диске Telegram фиксируется как partial, а не sent', async () => {
      // 1. Добавляем заявку, у которой lead.file указан, но физического файла НЕТ на диске
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const missingFileLeadId = `ФС-TEST-MISSING-${Date.now()}`;
      leads.push({
        leadId: missingFileLeadId,
        name: 'Клиент Потерянный Файл',
        phone: '+7 (916) 222-33-44',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'pending',
          email: 'pending',
          attempts: { telegram: 0, email: 0 },
          updatedAt: new Date().toISOString()
        },
        file: {
          originalName: 'lost_drawing.dwg',
          filename: 'non_existent_disk_file_12345.dwg',
          size: 2048
        }
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // 2. Запускаем retry
      const retryRes = await fetch(`${BASE_URL}/api/internal/retry`, { method: 'POST' });
      if (retryRes.status !== 200) throw new Error(`HTTP ${retryRes.status}`);

      // 3. Проверяем leads.json: telegram должен быть partial (НЕ sent!), и зафиксирован fileMissing: true
      const updatedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const updatedLead = updatedLeads.find(l => l.leadId === missingFileLeadId);
      if (!updatedLead) throw new Error('Заявка не найдена в leads.json');
      if (updatedLead.notifications.telegram !== 'partial') {
        throw new Error(`Ожидался telegram === 'partial' (так как файл отсутствует), получено: ${updatedLead.notifications.telegram}`);
      }
      if (updatedLead.notifications.fileMissing !== true) {
        throw new Error('Ожидался флаг fileMissing === true');
      }
    });

    await testCase('6.10. Лимит попыток: заявки с исчерпанным лимитом попыток (attempts >= 3) пропускаются и не зацикливают retry', async () => {
      // 1. Добавляем заявку с исчерпанным лимитом попыток (3)
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const exhaustedLeadId = `ФС-TEST-EXHAUSTED-${Date.now()}`;
      leads.push({
        leadId: exhaustedLeadId,
        name: 'Клиент Исчерпан Лимит',
        phone: '+7 (916) 333-44-55',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'failed',
          email: 'failed',
          attempts: { telegram: 3, email: 3 },
          updatedAt: new Date().toISOString()
        },
        file: null
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // 2. Запускаем retry
      const retryRes = await fetch(`${BASE_URL}/api/internal/retry`, { method: 'POST' });
      if (retryRes.status !== 200) throw new Error(`HTTP ${retryRes.status}`);

      // 3. Проверяем leads.json: attempts не должны измениться (остаться 3), статус остался failed
      const updatedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const updatedLead = updatedLeads.find(l => l.leadId === exhaustedLeadId);
      if (!updatedLead) throw new Error('Заявка не найдена в leads.json');
      if (updatedLead.notifications.attempts?.telegram !== 3 || updatedLead.notifications.attempts?.email !== 3) {
        throw new Error(`Attempts изменились вопреки лимиту: ${JSON.stringify(updatedLead.notifications.attempts)}`);
      }
    });

    await testCase('6.11. Восстановление при рестарте процесса: сервер при старте поднимает pending заявки через retryPendingNotifications', async () => {
      // 1. Добавляем заявку в leads.json со статусом pending
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const restartLeadId = `ФС-TEST-RESTART-RECOVERY-${Date.now()}`;
      leads.push({
        leadId: restartLeadId,
        name: 'Клиент Рестарт Процесса',
        phone: '+7 (916) 444-55-66',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'pending',
          email: 'pending',
          attempts: { telegram: 0, email: 0 },
          updatedAt: new Date().toISOString()
        },
        file: null
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // 2. Убиваем процесс и запускаем с флагом TEST_ENABLE_STARTUP_RETRY
      serverProc.kill();
      await new Promise(r => setTimeout(r, 500));
      serverProc = await startServer(TEST_PORT, { TEST_ENABLE_STARTUP_RETRY: '1' });

      // Даем время на выполнение recovery
      await new Promise(r => setTimeout(r, 600));

      // 3. Проверяем leads.json: pending заявка была автоматически обработана
      const updatedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const updatedLead = updatedLeads.find(l => l.leadId === restartLeadId);
      if (!updatedLead) throw new Error('Заявка не найдена в leads.json');
      if (updatedLead.notifications.telegram !== 'sent') {
        throw new Error(`Ожидался telegram === 'sent' после рестарта, получено: ${updatedLead.notifications.telegram}`);
      }
      if (updatedLead.notifications.email !== 'sent') {
        throw new Error(`Ожидался email === 'sent' после рестарта, получено: ${updatedLead.notifications.email}`);
      }
    });

    await testCase('6.12. Дедупликация Telegram: при partial retry с существующим telegramMessageId текст не дублируется (messageSkipped = true)', async () => {
      const serverApp = require('../server');
      const testFile = {
        originalName: 'test_dedup.dwg',
        filename: 'test_dedup.dwg',
        size: 1024,
        path: path.join(TEST_UPLOADS_DIR, 'test_dedup.dwg')
      };
      fs.writeFileSync(testFile.path, 'sample file for dedup test');

      const leadWithMsgId = {
        leadId: 'ФС-TEST-DEDUP-001',
        name: 'Дедупликация Тест',
        phone: '+7 (916) 777-88-99',
        file: { originalName: 'test_dedup.dwg', filename: 'test_dedup.dwg', size: 1024 },
        notifications: {
          telegram: 'partial',
          telegramMessageId: 998877,
          attempts: { telegram: 1, email: 1 }
        }
      };

      // 1. Проверка формирования объекта статуса
      const resOnlyDoc = await serverApp.sendToTelegram(leadWithMsgId, testFile, { onlyDocument: true });
      if (resOnlyDoc.messageSkipped !== true) throw new Error('Ожидался messageSkipped === true');
      if (resOnlyDoc.messageSent !== false) throw new Error('Ожидался messageSent === false');
      if (resOnlyDoc.messageId !== 998877) throw new Error(`Ожидался сохраненный messageId === 998877, получено: ${resOnlyDoc.messageId}`);
      if (resOnlyDoc.documentSent !== true) throw new Error('Ожидался documentSent === true');
      if (resOnlyDoc.fullyDelivered !== true) throw new Error('Ожидался fullyDelivered === true');

      // 2. Unit-тест сетевого пайплайна: sendMessage НЕ вызывается вообще, sendDocument вызывается ровно 1 раз
      const apiCalls = [];
      const mockRequestTelegram = async (urlPath, method, headers, body) => {
        apiCalls.push({ urlPath, method });
        return { ok: true, data: { ok: true, result: { message_id: 12345 } } };
      };

      await serverApp.sendToTelegram(leadWithMsgId, testFile, {
        onlyDocument: true,
        useLiveClient: true,
        token: 'mock-bot-token',
        chatId: '-1001234567890',
        requestTelegram: mockRequestTelegram
      });

      const sendMessageCount = apiCalls.filter(c => c.urlPath.includes('sendMessage')).length;
      const sendDocumentCount = apiCalls.filter(c => c.urlPath.includes('sendDocument')).length;

      if (sendMessageCount !== 0) {
        throw new Error(`sendMessage был вызван ${sendMessageCount} раз(а), ожидалось 0 вызовов (дедупликация нарушена)!`);
      }
      if (sendDocumentCount !== 1) {
        throw new Error(`sendDocument был вызван ${sendDocumentCount} раз(а), ожидался ровно 1 вызов!`);
      }
    });

    await testCase('6.13. Фиксация provider IDs: в notifications сохраняются telegramMessageId, telegramDocSent и emailMessageId', async () => {
      const fd = new FormData();
      fd.append('name', 'Тест Provider IDs');
      fd.append('phone', '+7 (916) 555-11-22');
      fd.append('agreement', 'on');
      const b = new Blob(['sample data'], { type: 'application/octet-stream' });
      fd.append('attachment', b, 'provider_id_test.dwg');

      const res = await fetch(`${BASE_URL}/api/lead`, { method: 'POST', body: fd });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const lead = leads.find(l => l.leadId === json.leadId);
      if (!lead) throw new Error('Заявка не найдена в leads.json');
      if (!lead.notifications) throw new Error('Отсутствует объект notifications');
      if (!lead.notifications.telegramMessageId) throw new Error('Отсутствует telegramMessageId в notifications');
      if (lead.notifications.telegramDocSent !== true) throw new Error(`Ожидался telegramDocSent === true, получено: ${lead.notifications.telegramDocSent}`);
      if (!lead.notifications.emailMessageId) throw new Error('Отсутствует emailMessageId в notifications');
    });

    await testCase('6.14. Семафор параллельности: runWithNotificationQueue ограничивает одновременные задачи до MAX_CONCURRENT_NOTIFICATIONS (2)', async () => {
      const serverApp = require('../server');
      let activeCount = 0;
      let maxSeenActive = 0;

      const makeTask = (delayMs) => () => serverApp.runWithNotificationQueue(async () => {
        activeCount++;
        if (activeCount > maxSeenActive) maxSeenActive = activeCount;
        await new Promise(r => setTimeout(r, delayMs));
        activeCount--;
      });

      // Запускаем одновременно 5 задач
      await Promise.all([
        makeTask(50)(),
        makeTask(50)(),
        makeTask(50)(),
        makeTask(50)(),
        makeTask(50)()
      ]);

      if (maxSeenActive > 2) {
        throw new Error(`Семафор превышен: одновременно выполнялось ${maxSeenActive} задач (максимум 2)`);
      }
      if (maxSeenActive !== 2) {
        throw new Error(`Ожидалось достижение максимума в 2 задачи, зафиксировано: ${maxSeenActive}`);
      }
    });

    await testCase('6.15. Очистка устаревших метаданных при успешном retry: fileMissing, telegramDocError и emailError удаляются при переходе в sent', async () => {
      // 1. Создаем физический файл на диске
      const testFilename = `metadata_cleanup_${Date.now()}.dwg`;
      fs.writeFileSync(path.join(TEST_UPLOADS_DIR, testFilename), 'fake dwg for metadata cleanup test');

      // 2. Добавляем заявку с устаревшими флагами ошибок в leads.json
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const metadataLeadId = `ФС-TEST-CLEANUP-${Date.now()}`;
      leads.push({
        leadId: metadataLeadId,
        name: 'Клиент Очистка Метаданных',
        phone: '+7 (916) 999-11-22',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'partial',
          email: 'failed',
          telegramDocError: 'Вложение отсутствует на диске сервера',
          fileMissing: true,
          emailError: 'SMTP connect ECONNREFUSED',
          attempts: { telegram: 1, email: 1 },
          updatedAt: new Date().toISOString()
        },
        file: {
          originalName: 'metadata_test.dwg',
          filename: testFilename,
          size: 1024
        }
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // 3. Запускаем retry
      const retryRes = await fetch(`${BASE_URL}/api/internal/retry`, { method: 'POST' });
      if (retryRes.status !== 200) throw new Error(`HTTP ${retryRes.status}`);

      // 4. Проверяем leads.json: статусы стали sent, а флаги ошибок и fileMissing удалены
      const updatedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const updatedLead = updatedLeads.find(l => l.leadId === metadataLeadId);
      if (!updatedLead) throw new Error('Заявка не найдена в leads.json');
      if (updatedLead.notifications.telegram !== 'sent') {
        throw new Error(`Ожидался telegram === 'sent', получено: ${updatedLead.notifications.telegram}`);
      }
      if (updatedLead.notifications.email !== 'sent') {
        throw new Error(`Ожидался email === 'sent', получено: ${updatedLead.notifications.email}`);
      }
      if (updatedLead.notifications.fileMissing !== undefined) {
        throw new Error(`fileMissing не был удален: ${updatedLead.notifications.fileMissing}`);
      }
      if (updatedLead.notifications.telegramDocError !== undefined) {
        throw new Error(`telegramDocError не был удален: ${updatedLead.notifications.telegramDocError}`);
      }
      if (updatedLead.notifications.emailError !== undefined) {
        throw new Error(`emailError не был удален: ${updatedLead.notifications.emailError}`);
      }
    });

    await testCase('6.16. Ограничение очереди уведомлений (Backpressure): при переполнении очереди задачи отклоняются с кодом QUEUE_OVERFLOW', async () => {
      const serverApp = require('../server');
      const maxQueue = serverApp.MAX_NOTIFICATION_QUEUE || 50;

      // Заполняем слоты семафора долгоиграющими задачами
      let releaseHold = null;
      const holdPromise = new Promise(resolve => { releaseHold = resolve; });

      // Запускаем 2 задачи, которые занимают MAX_CONCURRENT_NOTIFICATIONS
      serverApp.runWithNotificationQueue(() => holdPromise);
      serverApp.runWithNotificationQueue(() => holdPromise);

      // Заполняем очередь ровно до maxQueue
      for (let i = 0; i < maxQueue; i++) {
        serverApp.runWithNotificationQueue(() => holdPromise);
      }

      // Следующая задача должна быть немедленно отклонена с ошибкой QUEUE_OVERFLOW
      let rejectedError = null;
      try {
        await serverApp.runWithNotificationQueue(async () => {});
      } catch (err) {
        rejectedError = err;
      }

      // Освобождаем зависшие задачи
      releaseHold();

      if (!rejectedError) {
        throw new Error('Задача не была отклонена при переполнении очереди!');
      }
      if (rejectedError.code !== 'QUEUE_OVERFLOW') {
        throw new Error(`Ожидался код ошибки QUEUE_OVERFLOW, получено: ${rejectedError.code} (${rejectedError.message})`);
      }
    });

    await testCase('6.17. Устойчивость к сбою записи статуса: буфер unpersistedNotificationPatches сохраняет статус при ошибке диска и синхронизирует его при восстановлении', async () => {
      const serverApp = require('../server');
      const testLeadId = `ФС-TEST-UNPERSISTED-${Date.now()}`;

      // Сначала создаем заявку на диске со статусом pending
      const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      leads.push({
        leadId: testLeadId,
        name: 'Клиент Сбой Диска',
        phone: '+7 (916) 000-11-22',
        source: 'Тест',
        createdAt: new Date().toISOString(),
        notifications: {
          telegram: 'pending',
          email: 'pending',
          attempts: { telegram: 0, email: 0 },
          updatedAt: new Date().toISOString()
        },
        file: null
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');

      // Имитируем реальный сбой диска: перехватываем fs.renameSync
      const originalRenameSync = fs.renameSync;
      let renameFailed = false;
      fs.renameSync = () => {
        renameFailed = true;
        const err = new Error('EACCES: permission denied, rename temporary file');
        err.code = 'EACCES';
        throw err;
      };

      const testPatch = {
        telegram: 'sent',
        email: 'sent',
        telegramMessageId: 888111,
        emailMessageId: 'smtp-ok-123'
      };

      try {
        // Вызываем обновление статуса - из-за сбоя диска оно должно вернуть false
        const saved = serverApp.updateLeadNotificationStatus(testLeadId, testPatch);
        if (saved !== false) {
          throw new Error(`Ожидалось, что updateLeadNotificationStatus вернет false при ошибке renameSync, получено: ${saved}`);
        }
        if (!renameFailed) {
          throw new Error('renameSync не был вызван!');
        }

        // Помещаем в буфер отложенных патчей (как это делает recordNotificationResults и retryPendingNotifications)
        serverApp.enqueueUnpersistedNotificationPatch(testLeadId, testPatch);
      } finally {
        // Восстанавливаем оригинальный renameSync
        fs.renameSync = originalRenameSync;
      }

      if (!serverApp.unpersistedNotificationPatches.has(testLeadId)) {
        throw new Error('Патч не сохранен в unpersistedNotificationPatches');
      }

      // Проверяем, что retryPendingNotifications учитывает in-memory статус и НЕ считает заявку требующей retry
      const pendingPatch = serverApp.unpersistedNotificationPatches.get(testLeadId);
      const effective = { ...leads.find(l => l.leadId === testLeadId).notifications, ...pendingPatch };
      if (serverApp.shouldRetryTelegram(effective) || serverApp.shouldRetryEmail(effective)) {
        throw new Error('Заявка ошибочно помечена к повторной отправке, хотя в in-memory буфере уже зафиксирован sent!');
      }

      // Вызываем flushUnpersistedNotificationPatches() и проверяем синхронизацию на диск
      serverApp.flushUnpersistedNotificationPatches();
      if (serverApp.unpersistedNotificationPatches.has(testLeadId)) {
        throw new Error('Патч остался в буфере после успешного flush');
      }

      const flushedLeads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const flushedLead = flushedLeads.find(l => l.leadId === testLeadId);
      if (flushedLead.notifications.telegram !== 'sent' || flushedLead.notifications.email !== 'sent') {
        throw new Error(`Статус не был записан на диск: ${JSON.stringify(flushedLead.notifications)}`);
      }
      if (flushedLead.notifications.telegramMessageId !== 888111) {
        throw new Error('telegramMessageId не был записан на диск');
      }
    });

    await testCase('6.18. Защита от утечки памяти: аварийный сброс в файл при превышении MAX_UNPERSISTED_PATCHES', async () => {
      const serverApp = require('../server');
      const overflowLeadId = `ФС-OVERFLOW-${Date.now()}`;

      // Наполняем буфер до 1000 элементов
      for (let i = 0; i < 1000; i++) {
        serverApp.unpersistedNotificationPatches.set(`DUMMY-${i}`, { telegram: 'sent' });
      }

      // Добавляем 1001-й элемент через enqueueUnpersistedNotificationPatch
      serverApp.enqueueUnpersistedNotificationPatch(overflowLeadId, {
        telegram: 'sent',
        email: 'sent',
        telegramMessageId: 999999
      });

      const emergencyPath = path.join(TEST_DATA_DIR, 'unpersisted_patches_emergency.json');
      if (!fs.existsSync(emergencyPath)) {
        throw new Error('Аварийный файл unpersisted_patches_emergency.json не был создан при превышении лимита!');
      }

      const emergencyContent = JSON.parse(fs.readFileSync(emergencyPath, 'utf8'));
      if (!emergencyContent[overflowLeadId] || emergencyContent[overflowLeadId].telegramMessageId !== 999999) {
        throw new Error('Данные заявки не найдены в аварийном файле!');
      }

      // Очищаем фиктивные записи
      for (let i = 0; i < 1000; i++) {
        serverApp.unpersistedNotificationPatches.delete(`DUMMY-${i}`);
      }

      // При flush аварийный файл считывается и удаляется
      serverApp.flushUnpersistedNotificationPatches();
      if (fs.existsSync(emergencyPath)) {
        throw new Error('Аварийный файл не был удален после flush!');
      }
      serverApp.unpersistedNotificationPatches.delete(overflowLeadId);
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
