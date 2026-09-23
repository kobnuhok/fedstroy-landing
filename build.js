// =========================================================================
// ООО «ФЕДСТРОЙ» — Модульный сборщик проекта
// 1. Компилирует Tailwind CSS (src/input.css -> css/tailwind.css)
// 2. Собирает HTML-блоки из blocks/ в корневой index.html
// 3. Собирает JS-модули в резервный app.js (для поддержки nomodule)
// =========================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const BLOCKS_DIR = path.join(ROOT_DIR, 'blocks');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const TEMPLATE_FILE = path.join(SRC_DIR, 'template.html');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const JS_MODULES_DIR = path.join(ROOT_DIR, 'js', 'modules');
const OUTPUT_JS = path.join(ROOT_DIR, 'app.js');

function buildCSS() {
  try {
    console.log('[Tailwind] Компиляция локального CSS...');
    execSync('npx @tailwindcss/cli -i src/input.css -o css/tailwind.css --minify', {
      cwd: ROOT_DIR,
      stdio: 'pipe'
    });
    const size = (fs.statSync(path.join(ROOT_DIR, 'css', 'tailwind.css')).size / 1024).toFixed(1);
    console.log(`[Tailwind OK] css/tailwind.css собран (${size} KB)`);
  } catch (err) {
    console.error('[Tailwind Error] Ошибка сборки CSS:', err.message);
  }
}

function buildHTML() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    console.error(`[Build Error] Файл шаблона не найден: ${TEMPLATE_FILE}`);
    return;
  }

  let html = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  // Поиск директив <!-- @@include blocks/block.html -->
  const includeRegex = /<!--\s*@@include\s+([^\s]+)\s*-->/g;

  html = html.replace(includeRegex, (match, blockRelPath) => {
    const blockPath = path.join(ROOT_DIR, blockRelPath);
    if (fs.existsSync(blockPath)) {
      const blockContent = fs.readFileSync(blockPath, 'utf8');
      return `\n  <!-- Block: ${blockRelPath} -->\n${blockContent.trim()}\n`;
    } else {
      console.warn(`[Build Warning] Блок не найден, пропущен: ${blockRelPath}`);
      return `<!-- Block omitted: ${blockRelPath} -->`;
    }
  });

  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  console.log(`[Build OK] index.html собран (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
}

function buildJS() {
  const moduleFiles = [
    'navigation.js',
    'calculator.js',
    'quiz.js',
    'portfolio.js',
    'lightbox.js',
    'floating-dock.js',
    'uploader.js',
    'forms.js'
  ];

  let bundleContent = `// ООО «ФЕДСТРОЙ» — Клиентский бандл\n`;
  bundleContent += `// Автоматическая сборка для устаревших браузеров (nomodule)\n\n`;
  bundleContent += `(() => {\n`;

  // Включаем CONFIG
  const configPath = path.join(ROOT_DIR, 'js', 'config.js');
  if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, 'utf8');
    cfg = cfg.replace(/export\s+const\s+CONFIG/g, 'const CONFIG');
    bundleContent += `  // --- Конфигурация ---\n  ${cfg.split('\n').join('\n  ')}\n\n`;
  }

  const inits = [];

  moduleFiles.forEach(file => {
    const modPath = path.join(JS_MODULES_DIR, file);
    if (fs.existsSync(modPath)) {
      let code = fs.readFileSync(modPath, 'utf8');
      // Удаляем ES import/export
      code = code.replace(/import\s+[^;]+;/g, '');
      code = code.replace(/export\s+function\s+([a-zA-Z0-9_]+)\s*\(/g, 'function $1(');
      code = code.replace(/export\s+const\s+/g, 'const ');

      bundleContent += `  // --- Модуль: ${file} ---\n`;
      bundleContent += `  ${code.split('\n').join('\n  ')}\n\n`;

      const match = code.match(/function\s+(init[a-zA-Z0-9_]+)\s*\(/);
      if (match && match[1]) {
        inits.push(match[1]);
      }
    }
  });

  bundleContent += `  document.addEventListener('DOMContentLoaded', () => {\n`;
  inits.forEach(initFn => {
    bundleContent += `    try { ${initFn}(); } catch (e) { console.warn('[FedStroy Module ${initFn} Error]:', e); }\n`;
  });
  bundleContent += `  });\n`;
  bundleContent += `})();\n`;

  fs.writeFileSync(OUTPUT_JS, bundleContent, 'utf8');
  console.log(`[Build OK] app.js собран (${(Buffer.byteLength(bundleContent, 'utf8') / 1024).toFixed(1)} KB)`);
}

function runBuild() {
  const startTime = Date.now();
  console.log('--- Начало сборки ООО «ФЕДСТРОЙ» ---');
  buildCSS();
  buildHTML();
  buildJS();
  console.log(`--- Сборка завершена за ${Date.now() - startTime} мс ---\n`);
}

// Запуск сборки
runBuild();

// Режим отслеживания
if (process.argv.includes('--watch')) {
  console.log('[Watch Mode] Отслеживание изменений в blocks/, css/, js/, src/ ...');
  const watchDirs = [BLOCKS_DIR, SRC_DIR, JS_MODULES_DIR, path.join(ROOT_DIR, 'css')];

  watchDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.includes('index.html') && !filename.includes('app.js') && !filename.includes('tailwind.css')) {
          console.log(`[Изменение: ${filename}]. Пересборка...`);
          runBuild();
        }
      });
    }
  });
}
