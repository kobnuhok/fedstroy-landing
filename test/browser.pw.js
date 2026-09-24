// Browser E2E — реальный Chromium + реальный <input type="file">
// Запуск: npm run test:e2e
// Сервер поднимается через playwright.config.js webServer

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Создать временный файл-заглушку DWG
function makeTempDwg() {
  const tmpPath = path.join(os.tmpdir(), `test-drawing-${Date.now()}.dwg`);
  fs.writeFileSync(tmpPath, Buffer.alloc(4 * 1024, 0x20)); // 4 КБ пробелов
  return tmpPath;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = '* { scroll-behavior: auto !important; }';
    (document.head || document.documentElement).appendChild(style);
  });
});

// ============================================================
// ДЕСКТОП ТЕСТЫ (только для desktop viewport)
// ============================================================

test('desktop: форма калькулятора — заполнить, прикрепить DWG, отправить → экран успеха с ФС-номером', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Тест для десктопа');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/ФЕДСТРОЙ/i);

  // Скроллим к секции калькулятора
  await page.locator('#calculator').scrollIntoViewIfNeeded();

  const form = page.locator('#calculator form.js-lead-form');

  // Заполняем имя и телефон
  await form.locator('input[name="name"]').fill('Алексей Инженер ПТО');
  await form.locator('input[name="phone"]').fill('+7 (916) 555-44-33');

  // Чекбокс согласия
  const agree = form.locator('input[name="agreement"]');
  if (!(await agree.isChecked())) await agree.check();

  // Прикрепляем реальный DWG-файл через нативный file input
  const dwgPath = makeTempDwg();
  try {
    await form.locator('input[type="file"]').setInputFiles(dwgPath);

    // Проверяем, что uploader.js переключил превью файла
    await expect(form.locator('.js-dropzone-preview')).not.toHaveClass(/hidden/, { timeout: 3000 });
    await expect(form.locator('.js-file-name')).toContainText('.dwg');

    // Нажимаем кнопку отправки
    const submitBtn = form.locator('button[type="submit"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    // Экран успеха с уникальным номером заявки ФС-YYYYMMDD-xxxxxxxx
    const successId = page.locator('.js-success-lead-id');
    await expect(successId).toBeVisible({ timeout: 8000 });
    const idText = await successId.textContent();
    expect(idText).toMatch(/Номер заявки: ФС-\d{8}-[0-9a-f]{8}/);
  } finally {
    try { fs.unlinkSync(dwgPath); } catch (_) {}
  }
});

test('desktop: клиентская валидация — пустая отправка → ошибки отображаются', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Тест для десктопа');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#calculator').scrollIntoViewIfNeeded();

  const form = page.locator('#calculator form.js-lead-form');

  // Очищаем поля
  await form.locator('input[name="name"]').fill('');
  await form.locator('input[name="phone"]').fill('');

  const submitBtn = form.locator('button[type="submit"]');
  await submitBtn.scrollIntoViewIfNeeded();
  await submitBtn.click();

  // Ошибки валидации должны стать видимыми
  await expect(form.locator('#error-lead-name')).not.toHaveClass(/hidden/);
  await expect(form.locator('#error-lead-phone')).not.toHaveClass(/hidden/);

  // Экран успеха не должен появиться
  await expect(page.locator('.js-success-lead-id')).not.toBeVisible();
});

test('desktop: навигация по якорям из хедера скроллит к секции', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Тест для десктопа');

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Кликаем по ссылке «Калькулятор» в десктопной шапке
  const navCalc = page.locator('nav a[href="#calculator"]').first();
  await expect(navCalc).toBeVisible();
  await navCalc.click();

  // Секция калькулятора во viewport
  await expect(page.locator('#calculator')).toBeInViewport({ timeout: 4000 });
});

test('desktop: квиз — прохождение всех шагов и формирование черновика сметы ПР-XXXX', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Тест для десктопа');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#quiz').scrollIntoViewIfNeeded();

  const nextBtn = page.locator('#quiz-next-btn');

  // Проходим шаги 1, 2, 3, 4
  for (let step = 1; step <= 4; step++) {
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();
    await page.waitForTimeout(100);
  }

  // На 5-м шаге: результат квиза виден
  const resultContainer = page.locator('#quiz-step-5');
  await expect(resultContainer).not.toHaveClass(/hidden/, { timeout: 4000 });

  const resultCode = page.locator('#quiz-result-code');
  await expect(resultCode).toBeVisible({ timeout: 4000 });
  await expect(resultCode).toContainText('Черновик сметы ПР-');
});

// ============================================================
// МОБИЛЬНЫЕ ТЕСТЫ (Pixel 5 viewport, touch)
// ============================================================

test('mobile: секция калькулятора адаптивна, нет горизонтального переполнения', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Тест для мобильных');

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Проверка отсутствия горизонтального скролла на странице
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  // Скроллим к калькулятору
  await page.locator('#calculator').scrollIntoViewIfNeeded();
  await expect(page.locator('#calculator')).toBeVisible();

  // Кнопка отправки внутри viewport по ширине (не обрезана)
  const submitBtn = page.locator('#calculator button[type="submit"]');
  await submitBtn.scrollIntoViewIfNeeded();
  await expect(submitBtn).toBeVisible();

  const btnBox = await submitBtn.boundingBox();
  expect(btnBox).not.toBeNull();
  expect(btnBox.x).toBeGreaterThanOrEqual(0);
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(clientWidth + 2);
});

test('mobile: бургер-меню открывается и закрывается по тапу', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Тест для мобильных');

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const mobileMenu = page.locator('#mobile-menu');
  const menuBtn = page.locator('#mobile-menu-btn');

  // Изначально скрыто
  await expect(mobileMenu).not.toBeVisible();

  // Открываем
  await menuBtn.click();
  await expect(mobileMenu).toBeVisible();

  // Закрываем
  await menuBtn.click();
  await expect(mobileMenu).not.toBeVisible();
});

test('mobile: отправка заявки через мобильный интерфейс', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Тест для мобильных');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#calculator').scrollIntoViewIfNeeded();

  const form = page.locator('#calculator form.js-lead-form');

  await form.locator('input[name="name"]').fill('Мобильный Заказчик');
  await form.locator('input[name="phone"]').fill('+7 (926) 999-88-77');

  const agree = form.locator('input[name="agreement"]');
  if (!(await agree.isChecked())) await agree.check();

  const submitBtn = form.locator('button[type="submit"]');
  await submitBtn.scrollIntoViewIfNeeded();
  await submitBtn.click();

  const successId = page.locator('.js-success-lead-id');
  await expect(successId).toBeVisible({ timeout: 8000 });
  await expect(successId).toContainText('ФС-');
});
