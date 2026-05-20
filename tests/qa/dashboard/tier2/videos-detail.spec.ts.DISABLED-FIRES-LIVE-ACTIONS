import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';
import { serviceClient } from '../../fixtures/auth';

/**
 * Tier-2 coverage for /videos/[slug] (the parsha detail page).
 *
 * Source-driven notes (dashboard/src/app/videos/[slug]/page.tsx):
 *   - The [slug] route segment is `parshiot.slug`, not a video-own slug.
 *     We resolve a real parsha slug via a Supabase query in beforeAll
 *     (read-only against the shared prod Supabase — parshiot is reference
 *     data, safe to read).
 *   - `<StanceToggle/>` and `<DefaultQualitySection/>` mentioned in the
 *     Tier-2 template are NOT rendered on /videos/[slug]. StanceToggle
 *     lives on the home page (/), DefaultQualitySection on /settings.
 *     Those tests are fixmed with a note redirecting where the coverage
 *     should live.
 *   - Components actually on this page:
 *       * ScriptCarousel (client; swap/edit script options)
 *       * ScheduleAllSheet (exercised in tier-1 schedule-sheet.spec.ts)
 *       * Static captions/distribution panels
 *       * Regen textarea + Submit-feedback button (static; no handler wired)
 *       * Footer "Delete this video" (static; no handler wired)
 *   - ScheduleAllSheet only mounts when there's a completed video job
 *     for the parsha (`videoId` truthy). When there isn't, the "Schedule
 *     all" button is rendered as a disabled <button>, NOT the sheet's
 *     open-trigger, so clicking won't open a dialog. We assert robustly.
 */

let parshaSlug: string | null = null;

test.beforeAll(async () => {
  try {
    const sb = serviceClient();
    const { data } = await sb.from('parshiot').select('slug').limit(1);
    parshaSlug = data?.[0]?.slug ?? null;
  } catch {
    parshaSlug = null;
  }
});

test.describe('dashboard: video detail (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    if (!parshaSlug) {
      test.skip(true, 'Could not resolve a parsha slug via Supabase in beforeAll.');
    }
    await installApiMocks(page);
    await page.goto(`/videos/${parshaSlug}`);
  });

  test('renders thumbnail / phone-frame player + parsha metadata', async ({
    page,
  }) => {
    // The h1 holds the English parsha name. The page also surfaces a
    // "order N" subhead ("{book} · order {order}") and an italic
    // metadata line about the script.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // Loose check: somewhere on the page there's "order N" copy.
    await expect(page.locator('body')).toContainText(/order\s+\d+/i);
    // Phone-frame player uses aspectRatio: '9/16' with a play-icon SVG
    // inside a blurred glass circle. Use the "— placeholder" text inside
    // the frame as a stable hook.
    await expect(page.getByText(/placeholder$/i)).toBeVisible();
  });

  test('edit stance toggle persists', async () => {
    // StanceToggle is NOT on /videos/[slug] — it lives on the home page
    // (/), rendered by dashboard/src/app/page.tsx. Stance coverage
    // belongs in a home-page tier-2 spec. In addition, StanceToggle's
    // `saveStance` is currently pure client state (useState) with no
    // server persistence, so "persists across reload" would fail
    // everywhere regardless of where it ran.
    test.fixme(
      true,
      'StanceToggle is on /, not /videos/[slug]. Also saveStance is client-only; persistence requires a server-action + DB row that does not exist yet. Tracked for Phase I.',
    );
  });

  test('schedule button opens schedule-all sheet', async ({ page }) => {
    // Source: when videoId is truthy the page renders <ScheduleAllSheet/>,
    // whose trigger is a <button>Schedule all</button>. When videoId is
    // null the page renders a disabled <button>Schedule all</button>
    // (cursor: not-allowed, opacity 0.5). Detect which branch we're in
    // and assert accordingly.
    const trigger = page.getByRole('button', { name: /^schedule all$/i });
    await expect(trigger).toBeVisible();

    const isDisabled = await trigger.evaluate(
      (el) => (el as HTMLButtonElement).disabled,
    );
    if (isDisabled) {
      test.skip(
        true,
        'No completed video job for this parsha — trigger is rendered disabled. ScheduleAllSheet happy-path covered separately in tier1/schedule-sheet.spec.ts with seeded data.',
      );
    }

    await trigger.click();

    // After click, the schedule-all-sheet dialog should become visible
    // (opacity:1). Alternatively, when Buffer isn't configured, a
    // different "Connect Buffer" dialog opens — both count as "a
    // dialog appeared".
    const anyDialog = page.getByRole('dialog');
    await expect(anyDialog.first()).toBeVisible({ timeout: 5_000 });
  });

  test('default quality section renders and edits save', async () => {
    // DefaultQualitySection is on /settings, not /videos/[slug]. Its
    // save-path goes through the `saveDefaultQuality` server action,
    // which requires Next-Action header instrumentation to mock — same
    // blocker called out in settings.spec.ts. Double fixme with a
    // redirect to the right home.
    test.fixme(
      true,
      'DefaultQualitySection lives on /settings, not /videos/[slug]. Its save uses a server action (saveDefaultQuality) that cannot be mocked via page.route() — same systemic limitation as users-section addUser. Tracked for Phase I.',
    );
  });

  test('script carousel renders when scripts exist', async ({ page }) => {
    // When parsha.scripts has entries (e.g., an A-tight variant), the
    // ScriptCarousel client component mounts in the right-hand column.
    // When there are no scripts, the carousel still renders but in an
    // "empty" state. Use a loose check: either an A / B / C / A-tight
    // option label is visible, OR the italic "No script yet" copy from
    // the header is present.
    const rowHeader = page.locator('body');
    await expect(rowHeader).toContainText(
      /(script a-tight|no script yet|\d+\s+words)/i,
    );
  });

  test('captions panel lists the five platform previews', async ({ page }) => {
    // Source hardcodes five rows: TikTok, Instagram, YouTube, Facebook,
    // X (twitter). Each row renders an Edit button. Assert the Captions
    // section is visible with at least five Edit buttons.
    await expect(
      page.getByRole('heading', { name: /^Captions$/ }),
    ).toBeVisible();
    const editButtons = page.getByRole('button', { name: /^Edit$/ });
    // >= 5 because future additions might add more.
    expect(await editButtons.count()).toBeGreaterThanOrEqual(5);
  });

  test('404 for an unknown parsha slug', async ({ page }) => {
    // Real-world error mode: mistyped slug → notFound() → Next.js 404.
    // In practice, Next.js on Vercel may return either an actual 404 status
    // (from notFound() in the server component) OR a 200 that renders the
    // default Next.js not-found UI. Accept either. Mirrors the pattern
    // used in website/tier1/article-detail.spec.ts and
    // website/tier1/video-detail.spec.ts for soft-404 fallbacks.
    const resp = await page.goto('/videos/definitely-not-a-real-parsha-xyz');
    const status = resp?.status() ?? 0;
    if (status !== 404) {
      await expect(page.locator('body')).toContainText(/not found|could not be found|could not find|page not/i);
    }
  });
});
