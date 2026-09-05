import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: process.env.CI ? 180000 : 60000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: process.env.TANK_TEST_URL || 'http://localhost:4173/TankBattle/',
    browserName: process.env.TANK_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium',
    channel: process.env.TANK_TEST_BROWSER !== 'webkit' && process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    launchOptions: { args: process.env.TANK_TEST_BROWSER === 'webkit' ? [] : ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 4173',
    url: 'http://localhost:4173/TankBattle/',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
