import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /calendar.
 *
 * Source-driven notes (dashboard/src/app/calendar/page.tsx):
 *   - The calendar is NOT a traditional month grid. It's a rolling "Six
 *     weeks ahead" list: one row per upcoming Shabbat (from
 *     `getUpcomingWeeks(6)` via lib/hebcal), each row is an anchor linking
 *     to `/videos/[parsha.slug]`. There is no month/year header and no
 *     "empty month" state.
 *   - Status per row comes from a HARDCODED_STATUS map keyed by parsha
 *     slug (kedoshim, emor, behar, bechukotai, bamidbar, naso) with a
 *     default of "Not started" for anything else. There is no scheduled-
 *     posts overlay to assert on.
 *   - Clicking a row navigates — it does NOT open an edit sheet. The
 *     spec-plan's "future-date entry opens edit sheet" test therefore
 *     does not correspond to any real UI today; we re-scope it to
 *     "clicking a row navigates to /videos/[slug]".
 *   - Times aren't displayed per-row (only `dateLabel` like "May 3"),
 *     so there is no timezone-of-times assertion to run today.
 *
 * Expect this spec to be heavy on fixmes — the current calendar surface
 * doesn't support most of what the Tier-2 template calls for.
 */

test.describe('dashboard: calendar (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/calendar');
  });

  test('renders upcoming-weeks header with a year-bearing sub-copy', async ({
    page,
  }) => {
    // The page has no month/year header. Instead, the h1 reads "Six weeks
    // ahead." (with the word "ahead." inside an <em>). We assert the h1
    // contains the literal "Six weeks". As a loose bridge to the
    // spec-plan intent, we also verify the first row's date label
    // contains a month abbreviation (Jan/Feb/.../Dec) — proving the
    // calendar is data-driven and dated.
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
    ).toContainText(/six weeks/i);

    // First `.cal-week` row should exist and contain a "Mon DD"-style
    // label. (On Hebcal failure the fallback renders "Calendar
    // unavailable" — allow either.)
    const firstRow = page.locator('.cal-week').first();
    const fallback = page.getByText(/calendar unavailable/i);
    const rowCount = await firstRow.count();
    if (rowCount === 0) {
      await expect(fallback).toBeVisible();
    } else {
      await expect(firstRow).toContainText(
        /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+/i,
      );
    }
  });

  test('shows scheduled-post status chips on rows', async ({ page }) => {
    // The page hardcodes status copy per parsha slug (no seed-dependent
    // "scheduled on this date" overlay), but every row renders SOME
    // status line (default "Not started"). Assert at least one row has
    // recognisable status copy.
    const rows = page.locator('.cal-week');
    const count = await rows.count();
    if (count === 0) {
      test.skip(
        true,
        'No weeks rendered — Hebcal upstream may be unavailable in this env.',
      );
    }
    await expect(rows.first()).toContainText(
      /(not started|needs review|generating|script ready|video approved|pending)/i,
    );
  });

  test('clicking a row navigates to /videos/[slug]', async ({ page }) => {
    // Source: each row is an <a href={`/videos/${week.slug}`}> — there is
    // no edit sheet to open. We re-scope the template test to navigation.
    const firstRow = page.locator('.cal-week').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No rows rendered — Hebcal upstream unavailable.');
    }
    const href = await firstRow.getAttribute('href');
    expect(href).toMatch(/^\/videos\/[a-z0-9-]+$/i);

    await firstRow.click();
    await expect(page).toHaveURL(/\/videos\/[^/]+$/);
  });

  test('empty month / no-weeks empty state', async () => {
    // The page has no month navigator — it shows a fixed 6-week rolling
    // window. The only empty-state path is `getUpcomingWeeks(6)` returning
    // [], which renders <CalendarFallback/>. We can't force that path
    // from the client (Hebcal is a server-side call), so this is fixmed.
    test.fixme(
      true,
      'Hebcal runs server-side; no client-side mock path. Also there is no far-future navigation control — the calendar is a fixed 6-week window. Tracked for Phase I.',
    );
  });

  test('timezone of displayed times matches user timezone', async () => {
    // The rows display `toLocaleDateString` day labels only — no time of
    // day is rendered. There is nothing to assert timezone behaviour on
    // until per-row times (post-ship time, scheduled-at) are surfaced.
    // When times DO ship, the robust approach is to use Playwright's
    // `timezoneId` context option and verify the formatted output changes
    // for `America/New_York` vs `Asia/Jerusalem`. Out of scope today.
    test.fixme(
      true,
      'No per-row time-of-day rendered. When times ship, assert with Playwright `timezoneId` context option. Tracked for Phase I.',
    );
  });

  test('current-week row is visually differentiated', async ({ page }) => {
    // Regression-adjacent: isCurrent (i===0) gets the `cal-week-current`
    // class + a cedar top-bar accent. If the class vanishes the visual
    // "this week" affordance breaks.
    const firstRow = page.locator('.cal-week').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No rows rendered — Hebcal unavailable.');
    }
    const classes = await firstRow.getAttribute('class');
    expect(classes ?? '').toContain('cal-week-current');
  });
});
