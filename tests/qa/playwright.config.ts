import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { desktop, tablet, mobile } from './fixtures/viewports';

loadEnv({ path: '.env.qa' });

const DASHBOARD_URL = process.env.DASHBOARD_URL!;
const WEBSITE_URL   = process.env.WEBSITE_URL!;

export default defineConfig({
  testDir: '.',
  testIgnore: ['**/fixtures/**', '**/scripts/**', '**/report/**', '**/design-review/**', '**/node_modules/**'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 6,
  reporter: [
    ['list'],
    ['json', { outputFile: 'results/playwright.json' }],
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'dashboard-desktop', testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...desktop, baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },
    { name: 'dashboard-tablet',  testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...tablet,  baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },
    { name: 'dashboard-mobile',  testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...mobile,  baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },

    { name: 'website-desktop', testMatch: /website\/.*\.spec\.ts/,
      use: { ...desktop, baseURL: WEBSITE_URL } },
    { name: 'website-tablet',  testMatch: /website\/.*\.spec\.ts/,
      use: { ...tablet,  baseURL: WEBSITE_URL } },
    { name: 'website-mobile',  testMatch: /website\/.*\.spec\.ts/,
      use: { ...mobile,  baseURL: WEBSITE_URL } },

    { name: 'a11y',     testMatch: /a11y\/.*\.spec\.ts/,     use: { ...desktop, storageState: 'storageState.json' } },
    { name: 'seo',      testMatch: /seo\/.*\.spec\.ts/,      use: { ...desktop, baseURL: WEBSITE_URL } },
    { name: 'security', testMatch: /security\/.*\.spec\.ts/, use: { ...desktop } },
  ],
});
