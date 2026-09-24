// Playwright configuration — browser E2E suite для fedstroy-landing
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.pw.js',
  timeout: 30_000,
  retries: 0,
  workers: 1, // последовательно — тест поднимает сервер сам

  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:8994',
    headless: true,
    video: 'off',
    screenshot: 'only-on-failure',
    trace: 'off',
  },

  webServer: {
    command: 'node server.js',
    url: 'http://localhost:8994/api/health',
    env: { PORT: '8994', NODE_ENV: 'test' },
    reuseExistingServer: false,
    timeout: 15_000,
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        // Pixel 5: 393x851, touch, UA мобильного Chrome
      },
    },
  ],
});
