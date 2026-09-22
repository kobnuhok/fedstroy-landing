// =========================================================================
// ООО «ФЕДСТРОЙ» — Быстрый модульный сборщик проекта (Node.js)
// Собирает HTML-блоки из blocks/ в корневой index.html
// Собирает модули из js/modules/ в корневой app.js
// Поддерживает режим отслеживания изменений: node build.js --watch
// =========================================================================

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const BLOCKS_DIR = path.join(ROOT_DIR, 'blocks');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const TEMPLATE_FILE = path.join(SRC_DIR, 'template.html');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const JS_MODULES_DIR = path.join(ROOT_DIR, 'js', 'modules');
const OUTPUT_JS = path.join(ROOT_DIR, 'app.js');

function buildHTML() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    console.error(`[Build Error] Файл шаблона не найден: ${TEMPLATE_FILE}`);
    return;
  }

  let html = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  // Регулярное выражение для поиска <!-- @@include path/to/block.html -->
  const includeRegex = /<!--\s*@@include\s+([^\s]+)\s*-->/g;

  html = html.replace(includeRegex, (match, blockRelPath) => {
    const blockPath = path.join(ROOT_DIR, blockRelPath);
    if (fs.existsSync(blockPath)) {
      const blockContent = fs.readFileSync(blockPath, 'utf8');
      return `\n  <!-- Block Start: ${blockRelPath} -->\n${blockContent.trim()}\n  <!-- Block End: ${blockRelPath} -->\n`;
    } else {
      console.warn(`[Build Warning] Блок не найден, пропущен: ${blockRelPath}`);
      return `<!-- Block omitted: ${blockRelPath} (file not found) -->`;
    }
  });

  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  console.log(`[Build OK] index.html успешно собран (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
}

function buildJS() {
  const moduleFiles = [
    'navigation.js',
    'calculator.js',
    'quiz.js',
    'portfolio.js',
    'lightbox.js',
    'floating-dock.js',
    'forms.js'
  ];

  let bundleContent = `// =========================================================================\n`;
  bundleContent += `// ООО «ФЕДСТРОЙ» — Production Bundle\n`;
  bundleContent += `// Скомпилировано автоматически из js/modules/\n`;
  bundleContent += `// Каждый модуль автономен и защищен от отсутствия DOM-элементов\n`;
  bundleContent += `// =========================================================================\n\n`;
  bundleContent += `document.addEventListener('DOMContentLoaded', () => {\n`;

  moduleFiles.forEach(file => {
    const modPath = path.join(JS_MODULES_DIR, file);
    if (fs.existsSync(modPath)) {
      let code = fs.readFileSync(modPath, 'utf8');
      // Заменяем export function initX() { на локальную функцию
      code = code.replace(/export\s+function\s+([a-zA-Z0-9_]+)\s*\(/g, 'function $1(');
      // Убираем возможные import строки
      code = code.replace(/^import\s+.*$/gm, '');
      bundleContent += `\n  // --- Module: ${file} ---\n`;
      bundleContent += `  try {\n`;
      bundleContent += `    ${code.split('\n').join('\n    ')}\n`;
      // Определяем имя функции initX
      const match = code.match(/function\s+(init[a-zA-Z0-9_]+)\s*\(/);
      if (match && match[1]) {
        bundleContent += `    ${match[1]}();\n`;
      }
      bundleContent += `  } catch (err) {\n`;
      bundleContent += `    console.warn('[FedStroy Module ${file} Error]:', err);\n`;
      bundleContent += `  }\n`;
    }
  });

  bundleContent += `});\n`;

  fs.writeFileSync(OUTPUT_JS, bundleContent, 'utf8');
  console.log(`[Build OK] app.js успешно скомпилирован (${(Buffer.byteLength(bundleContent, 'utf8') / 1024).toFixed(1)} KB)`);
}

function runBuild() {
  const startTime = Date.now();
  console.log('--- Начало сборки ООО «ФЕДСТРОЙ» ---');
  buildHTML();
  buildJS();
  console.log(`--- Сборка завершена за ${Date.now() - startTime} мс ---\n`);
}

// Запуск сборки
runBuild();

// Обработка флага --watch
if (process.argv.includes('--watch')) {
  console.log('[Watch Mode] Отслеживание изменений в blocks/, css/, js/, src/ ...');
  const watchDirs = [BLOCKS_DIR, SRC_DIR, JS_MODULES_DIR, path.join(ROOT_DIR, 'css')];

  watchDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.includes('index.html') && !filename.includes('app.js')) {
          console.log(`[File Changed] ${filename} (${eventType}). Пересборка...`);
          runBuild();
        }
      });
    }
  });
}
