import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /settings/seo. Grounded in:
 *   - dashboard/src/app/settings/seo/page.tsx (server component; fetches
 *     Storyblok defaults, passes into <SeoDefaultsForm />)
 *   - dashboard/src/app/settings/seo/seo-defaults-form.tsx (client form)
 *   - dashboard/src/app/api/settings/seo/route.ts (GET + PUT)
 *
 * FINDING — method mismatch: the master plan speaks of "PATCH to
 * /api/settings/seo" but the actual handler and client both use PUT
 * (route.ts line 14; seo-defaults-form.tsx line 60). The tests below
 * intercept PUT to match the real contract.
 *
 * The form has four fields: site_default_title, site_default_description,
 * site_default_og_image, twitter_handle. There is NO client-side length
 * validation in seo-defaults-form.tsx — the only gate is
 * JSON.stringify(form) going straight to PUT. The "invalid field length"
 * test is therefore `test.fixme`'d.
 */

test.describe('dashboard: settings/seo (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/settings/seo');
  });

  test('loads current SEO settings into form fields', async ({ page }) => {
    // The form mounts with four visible inputs regardless of whether the
    // Storyblok fetch succeeded (the page swallows the error and passes
    // empty defaults). So the assertion is: four input-shaped fields with
    // the correct labels are visible.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/SEO defaults/i);
    await expect(page.locator('input[type="text"]').first()).toBeVisible(); // title
    await expect(page.locator('textarea')).toBeVisible();                   // description
    await expect(page.locator('input[type="url"]')).toBeVisible();          // og image
    // Twitter handle is a second type="text" input. Count >= 2 covers it
    // without coupling to order.
    expect(await page.locator('input[type="text"]').count()).toBeGreaterThanOrEqual(2);
  });

  test('edits persist via PUT to /api/settings/seo', async ({ page }) => {
    // Intercept the PUT and echo a 200 with a minimal payload. The form
    // flips `saved=true` on a non-error response → "Saved." italic text
    // appears next to the Save button. We assert on that literal.
    await page.route('**/api/settings/seo', async (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ seo: { site_default_title: 'QA' } }),
        });
      }
      return route.continue();
    });

    // Touch the title field so handleSave has something to send.
    await page.locator('input[type="text"]').first().fill('QA test title');
    await page.getByRole('button', { name: /save defaults/i }).click();

    await expect(page.getByText(/^Saved\.?$/i)).toBeVisible({ timeout: 5_000 });
  });

  test('PUT 500 shows inline error', async ({ page }) => {
    await page.route('**/api/settings/seo', async (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Storyblok is down' }),
        });
      }
      return route.continue();
    });

    await page.locator('input[type="text"]').first().fill('QA test title');
    await page.getByRole('button', { name: /save defaults/i }).click();

    // The error branch renders the server-returned message OR the fallback
    // "Save failed". Either should match.
    await expect(
      page.locator('text=/Storyblok is down|Save failed/i').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('invalid field length (>N chars) is rejected', async () => {
    // FINDING: there is no client-side length validation in
    // seo-defaults-form.tsx — no maxLength, no character-count gate, no
    // pre-submit check. The PUT handler also doesn't length-validate (see
    // api/settings/seo/route.ts: it coerces to string and forwards). So
    // this test case has no source-level counterpart. Unfixme when the
    // form or route gains length validation.
    test.fixme(
      true,
      'No client- or server-side length validation exists in settings/seo today (seo-defaults-form.tsx + api/settings/seo/route.ts). Revisit when validation lands.',
    );
  });
});
