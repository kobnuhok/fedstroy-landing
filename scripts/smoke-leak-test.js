// Скрипт валидации отсутствия утечек данных и закрытия служебных каталогов
// Запуск: node scripts/smoke-leak-test.js [TARGET_URL]
// По умолчанию тестирует локальный сервер или продакшн Vercel

const TARGET_URL = process.argv[2] || process.env.TARGET_URL || 'https://fedstroy-landing.vercel.app';

console.log(`\n=== Запуск smoke-теста безопасности для: ${TARGET_URL} ===\n`);

const PROTECTED_PATHS = [
  '/data/leads.json',
  '/uploads/',
  '/src/template.html',
  '/src/input.css',
  '/blocks/header.html',
  '/test/test-scenarios.js',
  '/deploy/nginx.conf',
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/ecosystem.config.js',
  '/.env',
  '/.env.example',
  '/README.md'
];

const PUBLIC_PATHS = [
  '/',
  '/css/tailwind.css',
  '/js/main.js',
  '/privacy.html',
  '/api/health'
];

async function runSmokeTest() {
  let passed = 0;
  let failed = 0;

  console.log('1. Проверка блокировки защищенных и служебных файлов (должен быть 404):');
  for (const p of PROTECTED_PATHS) {
    try {
      const url = `${TARGET_URL}${p}`;
      const res = await fetch(url);
      if (res.status === 404) {
        console.log(`  [PASS] ${p} -> 404 Not Found`);
        passed++;
      } else {
        console.error(`  [FAIL] УТЕЧКА! ${p} вернул HTTP ${res.status}, ожидался 404`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERROR] Не удалось подключиться к ${p}:`, err.message);
      failed++;
    }
  }

  console.log('\n2. Проверка доступности публичных ресурсов (должен быть 200):');
  for (const p of PUBLIC_PATHS) {
    try {
      const url = `${TARGET_URL}${p}`;
      const res = await fetch(url);
      if (res.status === 200) {
        console.log(`  [PASS] ${p} -> 200 OK`);
        passed++;
      } else {
        console.error(`  [FAIL] Публичный ресурс недоступен: ${p} вернул HTTP ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERROR] Не удалось подключиться к ${p}:`, err.message);
      failed++;
    }
  }

  console.log(`\n=== Результат Smoke-теста: ${passed} пройдено, ${failed} провалено ===\n`);
  if (failed > 0) process.exit(1);
}

runSmokeTest();
