import { test, expect, type Page } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';
import { serviceClient } from '../../fixtures/auth';

/**
 * Tier-1 coverage for /channels — Buffer deep-link + YouTube OAuth.
 * Grounded in dashboard/src/app/channels/page.tsx and the three OAuth routes
 * under /api/auth/youtube/. Selectors target the actual DOM rendered by the
 * page: one card per platform, each with a connection-state indicator (a
 * colored dot + text "Connected"/"Not connected"), and a per-integration CTA.
 *
 * Notes on the setup-trick tests (3–5):
 *   - The real OAuth flow requires a Google account and cannot be driven
 *     from Playwright. Instead we INSERT a sentinel row into oauth_tokens
 *     before the test and DELETE it after, then reload /channels and assert
 *     the UI reflects the connected state. Uses `serviceClient()` from the
 *     auth fixture.
 *   - The sentinel pattern uses `account_name='QA_SEED_ROW'` so the wipe
 *     can target it precisely without racing real connections. Since
 *     `service` is the primary key on oauth_tokens, the upsert onConflict
 *     is 'service' — this DOES clobber a real youtube row if one exists.
 *     That's a caveat of running against prod; tests are marked as
 *     non-runnable against prod (typecheck-only per master plan).
 */

const QA_SENTINEL = 'QA_SEED_ROW';

async function insertFakeYoutubeConnection(): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from('oauth_tokens').upsert(
    {
      service: 'youtube',
      refresh_token: 'qa-fake-refresh-token',
      access_token: 'qa-fake-access-token',
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      account_id: 'qa-fake-channel',
      account_name: QA_SENTINEL,
      scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    },
    { onConflict: 'service' },
  );
  if (error) throw error;
}

async function wipeFakeYoutubeConnection(): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from('oauth_tokens').delete().eq('account_name', QA_SENTINEL);
  if (error) throw error;
}

/**
 * The YouTube card is identified by its header text "Youtube" (rendered as
 * `ch.name` in page.tsx). Buffer cards are Tiktok / Instagram / Facebook / X.
 * We scope CTAs by locating the card's root div that contains the platform
 * name, then descending into it for the action link/button.
 *
 * NOTE: `filter({ hasText: /^Name$/ })` matches the *full concatenated text*
 * of `.ch-card`, not just the name heading. A connected YouTube card's text
 * is e.g. "Youtube @handle Connected 3 posts in last 7 days Disconnect" —
 * an anchored `/^Youtube$/` never matches. We use an unanchored
 * case-insensitive match on the platform name as a word. Each platform name
 * is unique across cards so this is unambiguous (Tiktok, Instagram,
 * Facebook, X, Youtube, Website).
 */
function cardFor(page: Page, platformName: string) {
  // The card's text content runs together with no whitespace between the
  // platform label and the status row (the rendered HTML has each span
  // back-to-back), so word-boundary regex fails for most platforms. Each
  // platform label is unique within the set of cards, so a simple
  // case-insensitive substring via `hasText` is both safe and reliable.
  // For the single-letter platform "X" (Twitter's rebrand), anchor to the
  // label-only card header by combining with a starts-with guard via the
  // first text node — a scoped `first()` is enough because there's only one
  // X card per page.
  if (platformName === 'X') {
    // X appears first inside its card (the label). Find the card whose
    // first child text is exactly "X".
    return page.locator('.ch-card').filter({ has: page.getByText(/^X$/, { exact: false }) });
  }
  return page.locator('.ch-card').filter({ hasText: new RegExp(platformName, 'i') });
}

test.describe('dashboard: channels', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('Buffer connect CTA opens Buffer UI in a new tab', async ({ page }) => {
    await page.goto('/channels');

    // The Buffer CTA is rendered per-Buffer-channel. Its href is literally
    // the constant BUFFER_CHANNELS_URL = 'https://publish.buffer.com/channels'
    // in page.tsx. The copy is either "Connect in Buffer" (unconnected) or
    // "Manage in Buffer" (connected). Either way it's an <a target="_blank">.
    // We also fall back to matching on href to tolerate copy changes.
    const bufferLink = page
      .locator('a[href*="publish.buffer.com"]')
      .first();

    // If Buffer isn't configured in this env (no BUFFER_ACCESS_TOKEN), the
    // page renders "Set up Buffer" → /settings/buffer instead of the
    // external deep-link. Skip rather than fail in that case so the spec is
    // still green against bare envs.
    if ((await bufferLink.count()) === 0) {
      test.skip(true, 'BUFFER_ACCESS_TOKEN not configured in target env — deep-link CTA not rendered');
    }

    await expect(bufferLink).toHaveAttribute('target', '_blank');
    await expect(bufferLink).toHaveAttribute('href', /publish\.buffer\.com/);
    await expect(bufferLink).toHaveAttribute('rel', /noopener/);

    // Clicking must NOT cause a same-tab navigation. The target='_blank' +
    // rel='noopener' should open a new popup; the current page should stay
    // on /channels. Listen for the popup event AND assert URL unchanged.
    const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
    await bufferLink.click();
    await popupPromise; // we don't need to inspect it, just allow it to resolve
    await expect(page).toHaveURL(/\/channels/);
  });

  test('YouTube OAuth start navigates toward Google consent', async ({ page }) => {
    await page.goto('/channels');

    // The "Connect YouTube" CTA is only rendered when YouTube is NOT
    // connected. If it IS connected in this env, we see "Disconnect" instead
    // — skip this test in that case so we don't depend on seed state.
    const connectBtn = page.getByRole('link', { name: /connect youtube/i });
    if ((await connectBtn.count()) === 0) {
      test.skip(true, 'YouTube already connected in target env — Connect YouTube CTA not rendered');
    }

    // The CTA is a <Link href="/api/auth/youtube/start">. Clicking it issues
    // a GET to our API route, which responds 302 → accounts.google.com.
    // Playwright's default is to follow redirects on navigation, so we
    // capture the *final* URL via page.waitForURL matching Google's host,
    // which proves the intent. We pre-intercept the Google URL to avoid
    // actually hitting Google and to neutralize the page load there.
    await page.route('**/accounts.google.com/**', async (route) => {
      // Respond with a benign static HTML so we don't actually hit Google.
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>qa-google-stub</body></html>',
      });
    });

    // Listen for any request headed to accounts.google.com. Using
    // page.waitForRequest decouples us from whether the navigation completes
    // or gets short-circuited by our route handler.
    const googleRequestPromise = page.waitForRequest(
      (req) => /accounts\.google\.com/.test(req.url()),
      { timeout: 10_000 },
    );
    await connectBtn.first().click();
    const googleReq = await googleRequestPromise;
    expect(googleReq.url()).toMatch(/accounts\.google\.com\/o\/oauth2/);
    // And the URL should carry the OAuth params the start route sets.
    expect(googleReq.url()).toMatch(/client_id=/);
    expect(googleReq.url()).toMatch(/response_type=code/);
    expect(googleReq.url()).toMatch(/scope=/);
  });

  test.describe.serial('with fake YouTube connection seeded', () => {
    // Desktop-only: these tests mutate the shared prod oauth_tokens.service='youtube'
    // row (primary-key unique). Running across dashboard-desktop/tablet/mobile
    // projects in parallel races on that single row. The seed + connection UI
    // is not viewport-dependent, so skipping on non-desktop is defensible.
    test.skip(
      ({ viewport }) => (viewport?.width ?? 0) < 1200,
      'Skipping on non-desktop — fake-seed race on shared prod DB.',
    );

    // Reseed before EACH test: the disconnect-flow test deletes the row,
    // so beforeAll-only seeding would leak state to subsequent tests.
    test.beforeEach(async () => {
      await insertFakeYoutubeConnection();
    });

    test.afterAll(async () => {
      await wipeFakeYoutubeConnection();
    });

    test('connected state renders on the YouTube card', async ({ page }) => {
      await page.goto('/channels');

      const youtubeCard = cardFor(page, 'Youtube');
      await expect(youtubeCard).toBeVisible();
      // Connected cards show the literal text "Connected" (not "Not connected").
      await expect(youtubeCard.getByText(/^Connected$/)).toBeVisible();
      // And the sentinel account_name is surfaced as the @handle.
      await expect(youtubeCard.getByText(`@${QA_SENTINEL}`)).toBeVisible();
      // A Disconnect button replaces the Connect CTA.
      await expect(youtubeCard.getByRole('button', { name: /disconnect/i })).toBeVisible();
    });

    test('disconnect flow clears the connection', async ({ page }) => {
      // Intercept the disconnect POST so we don't actually try to revoke a
      // fake refresh token at Google (which would 400). Respond with the
      // same 303 → /channels?yt=disconnected that the real route returns on
      // success, and delete the sentinel row server-side via the service
      // client so the next page load reflects the cleared state.
      await page.route('**/api/auth/youtube/disconnect', async (route) => {
        try {
          await wipeFakeYoutubeConnection();
        } catch {
          // Swallow — the afterAll hook will retry the wipe.
        }
        return route.fulfill({
          status: 303,
          headers: { Location: '/channels?yt=disconnected' },
          body: '',
        });
      });

      await page.goto('/channels');
      const youtubeCard = cardFor(page, 'Youtube');
      const disconnectBtn = youtubeCard.getByRole('button', { name: /disconnect/i });
      await expect(disconnectBtn).toBeVisible();

      // The disconnect form posts to /api/auth/youtube/disconnect. There is
      // no JS-level confirm() dialog in the current implementation — it's a
      // bare <form> submit. If a confirm() is ever added, handle it here.
      page.on('dialog', (d) => d.accept().catch(() => undefined));

      await disconnectBtn.click();

      // After redirect back to /channels the YouTube card should flip to
      // the Not-connected state. Next 16's client router cache can serve the
      // pre-disconnect HTML from the first goto — force a hard reload so the
      // server component re-runs and reflects the wiped seed row.
      await expect(page).toHaveURL(/\/channels/);
      await page.reload({ waitUntil: 'networkidle' });
      const youtubeCardAfter = cardFor(page, 'Youtube');
      await expect(youtubeCardAfter.getByText(/^Not connected$/)).toBeVisible();
      await expect(youtubeCardAfter.getByRole('link', { name: /connect youtube/i })).toBeVisible();
    });

    test('partial-connect: YT on + Buffer off renders both statuses distinctly', async ({ page }) => {
      await page.goto('/channels');

      // The YouTube card shows a "Connected" status pill (green dot +
      // "Connected" text). Buffer channels are independent — whether they
      // show Connected or Not connected depends on BUFFER_ACCESS_TOKEN and
      // Buffer's returned profiles, neither of which we control from here.
      // The required assertion is: at least one "Connected" AND at least one
      // "Not connected" visible on the page simultaneously. That's the
      // semantic of "partial connect — distinct statuses".
      const connectedCount = await page.getByText(/^Connected$/).count();
      const notConnectedCount = await page.getByText(/^Not connected$/).count();

      expect(connectedCount, 'YouTube card should show Connected').toBeGreaterThanOrEqual(1);

      if (notConnectedCount === 0) {
        // All Buffer channels happen to be connected too — we still have
        // distinct pills (YT Connected + website card with no status);
        // just verify both kinds of card visually exist.
        test.skip(true, 'All Buffer channels connected in this env — cannot assert mixed state');
      }

      expect(notConnectedCount, 'At least one Buffer card should show Not connected').toBeGreaterThanOrEqual(1);

      // Distinctness: YouTube card must be Connected AND at least one
      // Buffer card must be Not connected, simultaneously in the DOM.
      const youtubeCard = cardFor(page, 'Youtube');
      await expect(youtubeCard.getByText(/^Connected$/)).toBeVisible();

      // Find any Buffer card that's Not connected. We identify Buffer cards
      // by their platform names (the four BUFFER_PLATFORMS display names).
      const bufferCards = ['Tiktok', 'Instagram', 'Facebook', 'X'];
      let foundDisconnectedBuffer = false;
      for (const name of bufferCards) {
        const card = cardFor(page, name);
        if ((await card.count()) === 0) continue;
        if ((await card.getByText(/^Not connected$/).count()) > 0) {
          foundDisconnectedBuffer = true;
          break;
        }
      }
      expect(foundDisconnectedBuffer, 'At least one Buffer card should be Not connected while YouTube is Connected').toBe(true);
    });
  });
});
