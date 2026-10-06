/**
 * Playwright — configuração VEG (CI GitHub Actions + local)
 */
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'veg_e2e_CORRIGIDO.spec.js',
  timeout: 60_000,               // 60s por teste (esperas de backend incluídas)
  expect: { timeout: 10_000 },
  fullyParallel: false,          // testes partilham conta demo → sequencial
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { open: 'never' }],
    ['github'],                  // anota falhas directamente no PR/Action
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.VEG_APP_URL,   // opcional; a spec usa CONFIG.APP_URL
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
