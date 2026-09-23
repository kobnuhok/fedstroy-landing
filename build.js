// Скрипт сборки проекта:
// 1. Компиляция Tailwind CSS (src/input.css -> css/tailwind.css)
// 2. Вставка блоков из blocks/ в src/template.html -> index.html
// 3. Бандл клиентских скриптов -> app.js (для браузеров без поддержки type="module")

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
  console.log('[build:css] Сборка Tailwind CSS...');
  try {
    execSync('npx @tailwindcss/cli -i src/input.css -o css/tailwind.css --minify', {
      cwd: ROOT_DIR,
      stdio: 'pipe'
    });
    const size = (fs.statSync(path.join(ROOT_DIR, 'css', 'tailwind.css')).size / 1024).toFixed(1);
    console.log(`[build:css] Готово: css/tailwind.css (${size} KB)`);
  } catch (err) {
    console.error('[build:css:error] Ошибка компиляции CSS:', err.message);
    if (err.stderr) console.error(err.stderr.toString());
    throw err;
  }
}

function buildHTML() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error(`Файл шаблона не найден: ${TEMPLATE_FILE}`);
  }

  let html = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const includeRegex = /<!--\s*@@include\s+([^\s]+)\s*-->/g;

  html = html.replace(includeRegex, (match, blockRelPath) => {
    const blockPath = path.join(ROOT_DIR, blockRelPath);
    if (!fs.existsSync(blockPath)) {
      throw new Error(`Блок не найден: ${blockPath}`);
    }
    const blockContent = fs.readFileSync(blockPath, 'utf8');
    return `\n  <!-- ${blockRelPath} -->\n${blockContent.trim()}\n`;
  });

  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  const size = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[build:html] Готово: index.html (${size} KB)`);
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

  let bundleContent = `// Клиентский бандл для браузеров с поддержкой nomodule\n`;
  bundleContent += `(() => {\n`;

  const configPath = path.join(ROOT_DIR, 'js', 'config.js');
  if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, 'utf8');
    cfg = cfg.replace(/export\s+const\s+CONFIG/g, 'const CONFIG');
    bundleContent += `  // config\n  ${cfg.split('\n').join('\n  ')}\n\n`;
  }

  const inits = [];

  moduleFiles.forEach(file => {
    const modPath = path.join(JS_MODULES_DIR, file);
    if (fs.existsSync(modPath)) {
      let code = fs.readFileSync(modPath, 'utf8');
      code = code.replace(/import\s+[^;]+;/g, '');
      code = code.replace(/export\s+function\s+([a-zA-Z0-9_]+)\s*\(/g, 'function $1(');
      code = code.replace(/export\s+const\s+/g, 'const ');

      bundleContent += `  // ${file}\n`;
      bundleContent += `  ${code.split('\n').join('\n  ')}\n\n`;

      const match = code.match(/function\s+(init[a-zA-Z0-9_]+)\s*\(/);
      if (match && match[1]) {
        inits.push(match[1]);
      }
    }
  });

  bundleContent += `  document.addEventListener('DOMContentLoaded', () => {\n`;
  inits.forEach(initFn => {
    bundleContent += `    ${initFn}();\n`;
  });
  bundleContent += `  });\n`;
  bundleContent += `})();\n`;

  fs.writeFileSync(OUTPUT_JS, bundleContent, 'utf8');
  const size = (Buffer.byteLength(bundleContent, 'utf8') / 1024).toFixed(1);
  console.log(`[build:js] Готово: app.js (${size} KB)`);
}

function runBuild() {
  const startTime = Date.now();
  console.log('[build] Старт сборки...');
  try {
    buildCSS();
    buildHTML();
    buildJS();
    console.log(`[build] Сборка успешно завершена (${Date.now() - startTime} мс)`);
  } catch (err) {
    console.error('[build:fatal] Сборка прервана из-за ошибки:', err.message);
    if (!process.argv.includes('--watch')) {
      process.exit(1);
    }
  }
}

runBuild();

if (process.argv.includes('--watch')) {
  console.log('[watch] Отслеживание изменений в blocks/, css/, js/, src/ ...');
  const watchDirs = [
    BLOCKS_DIR,
    SRC_DIR,
    path.join(ROOT_DIR, 'js'),
    path.join(ROOT_DIR, 'css')
  ];

  watchDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.includes('index.html') && !filename.includes('app.js') && !filename.includes('tailwind.css')) {
          console.log(`[watch] Изменен файл: ${filename}. Пересборка...`);
          runBuild();
        }
      });
    }
  });
}
