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
const PAGE_TEMPLATE_FILE = path.join(SRC_DIR, 'page-template.html');
const SEO_PAGES_FILE = path.join(SRC_DIR, 'seo-pages.json');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const SITEMAP_FILE = path.join(ROOT_DIR, 'sitemap.xml');
const BASE_URL = 'https://fedstroy-landing.vercel.app';
const JS_MODULES_DIR = path.join(ROOT_DIR, 'js', 'modules');
const OUTPUT_JS = path.join(ROOT_DIR, 'app.js');

function resolveIncludes(html) {
  const includeRegex = /<!--\s*@@include\s+([^\s]+)\s*-->/g;
  return html.replace(includeRegex, (match, blockRelPath) => {
    const blockPath = path.join(ROOT_DIR, blockRelPath);
    if (!fs.existsSync(blockPath)) {
      throw new Error(`Блок не найден: ${blockPath}`);
    }
    const blockContent = fs.readFileSync(blockPath, 'utf8');
    return `\n  <!-- ${blockRelPath} -->\n${blockContent.trim()}\n`;
  });
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

  const html = resolveIncludes(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  const size = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[build:html] Готово: index.html (${size} KB)`);
}

function buildSEOPages() {
  if (!fs.existsSync(SEO_PAGES_FILE) || !fs.existsSync(PAGE_TEMPLATE_FILE)) {
    return;
  }

  const pages = JSON.parse(fs.readFileSync(SEO_PAGES_FILE, 'utf8'));
  const pageMap = new Map(pages.map(p => [p.slug, p]));
  const rawTemplate = fs.readFileSync(PAGE_TEMPLATE_FILE, 'utf8');

  pages.forEach(page => {
    const canonical = `${BASE_URL}/${page.slug}.html`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Главная', item: `${BASE_URL}/` },
            { '@type': 'ListItem', position: 2, name: page.navTitle, item: canonical }
          ]
        },
        {
          '@type': 'Service',
          name: page.h1,
          description: page.description,
          provider: {
            '@type': 'LocalBusiness',
            name: 'ООО «ФЕДСТРОЙ»',
            url: `${BASE_URL}/`,
            telephone: '+7-800-700-02-23'
          },
          areaServed: 'RU',
          url: canonical
        }
      ]
    };

    const specsRows = (page.specs || []).map(([k, v]) =>
      `<tr><th class="py-3.5 px-5 font-semibold text-slate-600 w-2/5 align-top">${k}</th><td class="py-3.5 px-5 text-slate-900 font-medium">${v}</td></tr>`
    ).join('\n                  ');

    const detailsList = (page.details || []).map(item =>
      `<li class="flex items-start gap-2.5"><span class="text-brand-600 font-bold shrink-0">✓</span><span>${item}</span></li>`
    ).join('\n              ');

    const relatedLinks = (page.related || [])
      .map(slug => pageMap.get(slug))
      .filter(Boolean)
      .map(rel =>
        `<a href="./${rel.slug}.html" class="block p-4 bg-white rounded-2xl border border-slate-200 hover:border-brand-500 transition-colors"><span class="font-heading font-bold text-sm text-slate-900 block mb-1">${rel.navTitle}</span><span class="text-xs text-slate-500">${rel.priceTag}</span></a>`
      ).join('\n          ');

    let html = resolveIncludes(rawTemplate)
      .replace(/href="#([a-zA-Z0-9_-]+)"/g, 'href="./index.html#$1"')
      .replace(/\{\{TITLE\}\}/g, escapeHtmlAttr(page.title))
      .replace(/\{\{DESCRIPTION\}\}/g, escapeHtmlAttr(page.description))
      .replace(/\{\{CANONICAL\}\}/g, canonical)
      .replace(/\{\{IMAGE\}\}/g, page.image)
      .replace(/\{\{BREADCRUMB\}\}/g, page.navTitle)
      .replace(/\{\{PRICE_TAG\}\}/g, page.priceTag)
      .replace(/\{\{H1\}\}/g, page.h1)
      .replace(/\{\{LEAD\}\}/g, page.lead)
      .replace(/\{\{SERVICE_NAME\}\}/g, escapeHtmlAttr(page.serviceName))
      .replace(/\{\{SPECS_ROWS\}\}/g, specsRows)
      .replace(/\{\{DETAILS_LIST\}\}/g, detailsList)
      .replace(/\{\{RELATED_LINKS\}\}/g, relatedLinks)
      .replace(/\{\{JSON_LD\}\}/g, `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n  </script>`);

    fs.writeFileSync(path.join(ROOT_DIR, `${page.slug}.html`), html, 'utf8');
  });

  const lastmod = new Date().toISOString().slice(0, 10);
  const staticEntries = [
    { loc: `${BASE_URL}/`, changefreq: 'weekly', priority: '1.0' },
    ...pages.map(p => ({ loc: `${BASE_URL}/${p.slug}.html`, changefreq: 'weekly', priority: '0.8' })),
    { loc: `${BASE_URL}/requisites.html`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${BASE_URL}/privacy.html`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${BASE_URL}/consent.html`, changefreq: 'yearly', priority: '0.3' }
  ];

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticEntries.map(e => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP_FILE, sitemapXml, 'utf8');
  console.log(`[build:seo] Готово: ${pages.length} SEO-страниц и sitemap.xml`);
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
    buildHTML();
    buildSEOPages();
    buildCSS();
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
