import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { ensureTestUser, generateMagicLinkAction } from './fixtures/auth';

loadEnv({ path: '.env.qa' });

export default async function globalSetup() {
  const email = process.env.QA_TEST_EMAIL;
  const name  = process.env.QA_TEST_NAME;
  const dashboardUrl = process.env.DASHBOARD_URL;
  if (!email || !name || !dashboardUrl) {
    throw new Error('Missing QA_TEST_EMAIL, QA_TEST_NAME, or DASHBOARD_URL in tests/qa/.env.qa');
  }

  console.log('[qa] ensuring test user', email);
  await ensureTestUser(email, name);

  const { seedAll } = await import('./fixtures/seed-data');
  console.log('[qa] seeding test data');
  await seedAll();

  console.log('[qa] minting session via admin.generateLink');
  const actionLink = await generateMagicLinkAction(email, `${dashboardUrl}/auth/callback`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(actionLink);
  // Wait until the app leaves the auth callback and lands on the root.
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 30_000 });
  await ctx.storageState({ path: 'storageState.json' });
  await browser.close();

  console.log('[qa] setup complete — storageState.json written');
}
