import { test, expect } from '@playwright/test';

const WEBSITE_URL = process.env.WEBSITE_URL;

const SENSITIVE_ENV_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'BUFFER_ACCESS_TOKEN',
  'KIE_API_KEY',
  'STORYBLOK_MANAGEMENT_TOKEN',
  'STORYBLOK_WEBHOOK_SECRET',
  'YOUTUBE_CLIENT_SECRET',
  'OPENAI_API_KEY',
];

test.describe('website does not leak server secrets in HTML', () => {
  test('homepage', async ({ page }) => {
    test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
    await page.goto(`${WEBSITE_URL}/`);
    const html = await page.content();
    for (const envName of SENSITIVE_ENV_VARS) {
      const val = process.env[envName];
      if (!val) continue;  // Can't check what we don't have
      expect(html.includes(val), `${envName} value leaked into homepage HTML`).toBeFalsy();
    }
    // Sanity: no NEXT_PRIVATE vars either
    expect(html).not.toMatch(/service_role/i);
    expect(html).not.toMatch(/sk_live_/);
  });
});
