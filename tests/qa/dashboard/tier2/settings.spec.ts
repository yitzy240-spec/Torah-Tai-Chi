import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /settings. Grounded in:
 *   - dashboard/src/app/settings/page.tsx (server component; renders sections)
 *   - dashboard/src/components/users-section.tsx (client component; handles
 *     add/remove via the `addUser`/`removeUser` server actions)
 *   - dashboard/src/app/actions/manage-users.ts (the server actions themselves)
 *
 * Source-driven notes:
 *   - The add-user control is a React client component that calls the
 *     `addUser` server action directly (imported from the 'use server' file).
 *     Next.js dispatches that via a POST to the page URL with a Next-Action
 *     header and an encoded FormData/JSON payload. Intercepting it from
 *     Playwright is possible but brittle — the Next-Action ID changes with
 *     every build. Rather than mocking the action, we assert the UI-level
 *     validation path that happens BEFORE the action fires (required email,
 *     client-side trim/lowercase) and skip when a full server-action mock
 *     would be required. See per-test comments below.
 *   - The "Users" list on the page is always at least 1 (the current session
 *     user) because listUsers() runs server-side with the service client.
 *   - "Cost totals" on /settings means the Budget section ($80/month,
 *     $12.40 spent), not the global header CostTotals component ($0.00 this
 *     week). Assertion is loose: any $N.NN-ish token present in the section.
 *   - /settings/buffer, /settings/youtube, /settings/seo all exist as routes.
 *     Navigation from /settings goes via the Connected-accounts section —
 *     but as-of-source, that section renders plain <span>Connected</span>
 *     copy, NOT <a href="/settings/buffer">-style links. So the
 *     "navigation to subpages works" check is driven by direct `page.goto`
 *     rather than clicking through, and we assert the destination renders.
 */

test.describe('dashboard: settings (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/settings');
  });

  test('users section lists at least the current session user', async ({ page }) => {
    // The Users section heading is a literal <h2>Users</h2>.
    await expect(page.getByRole('heading', { name: /^Users$/ })).toBeVisible();

    // At least one user row must exist. Rows have a "You" chip when isSelf,
    // but we don't require the chip — just that >= 1 user item is rendered.
    // Use the per-row "Remove" absence OR the joined-date italic subline as
    // a proxy: both only appear once a user row has mounted.
    const rows = page.locator('text=/Joined [A-Z][a-z]+ \\d+, \\d{4}/');
    await expect(rows.first()).toBeVisible();
  });

  test('add user form with a valid email submits', async () => {
    // Intercepting the Next.js server action requires matching against the
    // page URL with a Next-Action header — the action ID rotates per build
    // so we'd need build-time instrumentation. Creating a real user against
    // prod Supabase is not safe. Flagged for Phase I.
    test.fixme(
      true,
      'Server-action mocking for addUser requires Next-Action header instrumentation that is not yet wired up. Tracked for Phase I.',
    );
  });

  test('add user form rejects an invalid email', async ({ page }) => {
    // The email input is type="email" with required. On submit, browsers
    // enforce HTML5 validation BEFORE the form handler runs — which means
    // no server action fires, so this test is safe to run against prod.
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.fill('not-an-email');
    await page.getByRole('button', { name: /add user/i }).click();

    // Accept either: :invalid pseudo-class, aria-invalid, or an inline error
    // <p> rendered by the server-action round-trip copy. The first match
    // is sufficient.
    const invalid = page.locator(
      '[aria-invalid="true"], input:invalid, text=/valid email/i',
    );
    await expect(invalid.first()).toBeVisible({ timeout: 5_000 });
  });

  test('add user form rejects a duplicate email', async () => {
    // See the fixme on the happy-path test above: intercepting the server
    // action to return the "already registered" error requires Next-Action
    // instrumentation we haven't built yet. The error-path assertion (red
    // inline <p>) IS rendered when `result.error` is set in
    // users-section.tsx, but we can't force that state from the test
    // without the mock. Flagged for Phase I.
    test.fixme(
      true,
      'Duplicate-email error path requires server-action interception — same blocker as the happy-path test.',
    );
  });

  test('remove self is disabled or absent for current user row', async ({ page }) => {
    // users-section.tsx renders the Remove button only when !u.isSelf. So
    // the assertion is: for the row labeled "You", there is no Remove
    // control. We locate the row containing the "YOU" chip text and scope
    // within it.
    const youChip = page.getByText(/^You$/).first();
    const hasYou = (await youChip.count()) > 0;
    if (!hasYou) {
      // In envs where the signed-in user isn't in the users list (e.g. a
      // service-role seed user), the "You" chip never renders — meaning
      // there's nothing to assert on. Skip rather than fail.
      test.skip(true, 'No "You" chip visible — current session user not rendered as a users-section row');
    }

    // Climb to the row container and check there's no Remove button inside.
    const youRow = youChip.locator('xpath=ancestor::div[contains(@style,"borderBottom")][1]');
    await expect(youRow.getByRole('button', { name: /^remove$/i })).toHaveCount(0);
  });

  test('cost totals render with numeric values', async ({ page }) => {
    // The Budget section always renders two $-tokens server-side (they are
    // hardcoded in page.tsx today). Loose regex catches any $N.NN, $N,NNN,
    // or $N/month variant so the assertion survives when the values go
    // live-computed later.
    const budgetHeading = page.getByRole('heading', { name: /^Budget$/ });
    await expect(budgetHeading).toBeVisible();

    const moneyRegex = /\$\s*\d[\d,]*(?:\.\d+)?/;
    // Scope to the Budget section via its parent <section>: the heading's
    // closest ancestor <section>. Using the heading → xpath ancestor keeps
    // the assertion tight even if the Budget section moves in the DOM.
    const budgetSection = budgetHeading.locator('xpath=ancestor::section[1]');
    await expect(budgetSection).toContainText(moneyRegex);
  });

  test.describe('subpage navigation', () => {
    for (const path of ['/settings/buffer', '/settings/youtube', '/settings/seo']) {
      test(`navigation to ${path} renders`, async ({ page }) => {
        await page.goto(path);
        // We don't assert which h1 renders — just that the destination is
        // on the expected URL and did not redirect to /login or 404.
        await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
        // And a heading of some kind is visible (smoke-level).
        await expect(page.getByRole('heading').first()).toBeVisible();
      });
    }
  });
});
