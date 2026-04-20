import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /settings/buffer. Grounded in
 * dashboard/src/app/settings/buffer/page.tsx — which as-of-source is
 * ALWAYS a static "how to connect Buffer" instructions page with numbered
 * steps + external deep-links (pricing, developers/apps). There is no
 * "connected state" branch on this page: Buffer connection state lives in
 * the BUFFER_ACCESS_TOKEN env var, checked on /channels, not here. The
 * master-plan "connected state renders" test case therefore does not have
 * a real counterpart and is `test.fixme`'d with that finding.
 */

test.describe('dashboard: settings/buffer (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/settings/buffer');
  });

  test('page renders without error', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/buffer/);
    // The page's H1 reads "Connect Buffer." — loose regex tolerates small
    // copy edits (e.g. adding "your" or dropping the period).
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Connect.*Buffer/i);
  });

  test('connected state renders when a Buffer token is present', async () => {
    // Finding: /settings/buffer is a static, state-less instructions page
    // as of dashboard/src/app/settings/buffer/page.tsx. It does NOT branch
    // on BUFFER_ACCESS_TOKEN — the token-present UI lives on /channels
    // (which is covered by tests/qa/dashboard/tier1/channels.spec.ts). The
    // "connected state renders on /settings/buffer" case therefore has no
    // source-level counterpart. If that UI is ever added here, unfixme.
    test.fixme(
      true,
      '/settings/buffer is a static instructions page; it has no connected-state branch. Connected UI for Buffer lives on /channels.',
    );
  });

  test('disconnected state renders a connect CTA pointing at Buffer external UI', async ({ page }) => {
    // Step 1 of the instruction list contains an external link to
    // buffer.com/pricing (labelled "buffer.com/pricing →"). Step 3 links
    // to buffer.com/developers/apps. Either is a valid "connect CTA" in
    // the disconnected-state sense.
    const bufferLink = page.locator('a[href*="buffer.com"]').first();
    await expect(bufferLink).toBeVisible();
    // Don't over-specify href — just ensure it points at buffer.com.
    await expect(bufferLink).toHaveAttribute('href', /buffer\.com/);
  });

  test('the connect CTA has target="_blank" and correct href', async ({ page }) => {
    const bufferLink = page.locator('a[href*="buffer.com"]').first();
    await expect(bufferLink).toHaveAttribute('target', '_blank');
    // rel=noopener noreferrer is set for all external links on this page
    // per the source — assert noopener specifically (the security-critical
    // half; noreferrer is UX-only).
    await expect(bufferLink).toHaveAttribute('rel', /noopener/);
  });
});
