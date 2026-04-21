import { test, expect, type Page, type Route } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-1 coverage for the Articles CMS flow in the dashboard. Grounded in the
 * source at dashboard/src/components/article-form.tsx +
 * dashboard/src/components/article-editor.tsx (worktree branch qa/master-suite).
 *
 * Source realities that shape this spec:
 *
 *   1. The CMS backs onto Storyblok (not Supabase). The browser only sees the
 *      dashboard's own `/api/articles` route; the server-side call to
 *      api.storyblok.com happens in Node and is invisible to page.route().
 *      We therefore intercept /api/articles (POST for create, PATCH for edit)
 *      on the browser layer and assert on the payload the form sends.
 *
 *   2. The only HTML5-`required` input on the new-article form is `Title`. Body
 *      is a Tiptap contenteditable (no native `required`). On top of that, the
 *      "Publish" primary button is `disabled` when `form.title.trim()` is empty.
 *      The "Save draft" button stays enabled even with an empty title — clicking
 *      it fires fetch() with an empty title, which the API will 400. The test
 *      asserts the practical gate: Publish is disabled + native form-invalid
 *      pattern when submitting empty. Body is NOT required client-side; we
 *      document that and only assert on Title.
 *
 *   3. Tiptap v2 uses both `.ProseMirror` and `.tiptap` on the contenteditable
 *      element (see article-editor.tsx line 241 CSS `.article-editor-content
 *      .tiptap.ProseMirror`). We target `.ProseMirror` for input and drop to
 *      the wrapping class `.article-editor-content` for formatted-DOM
 *      assertions (because `strong`/`a`/`h2`/`h3` only live inside the editor).
 *
 *   4. There is NO `code-block` toolbar button on the editor (see the full
 *      button list in article-editor.tsx: H2/H3, Bold, Italic, lists, Link,
 *      Blockquote). Code-block input via toolbar is not possible. The plan's
 *      item #2 says "bold, link, heading, code-block input" — we exercise
 *      bold + link + H2 via the toolbar and substitute `blockquote` for
 *      `code-block` (nearest available block type), documenting the swap.
 *
 *   5. There are NO required SEO fields on the form. All three SEO inputs
 *      (seo_title, seo_description, seo_og_image) live inside a collapsible
 *      "SEO settings" section and are all optional. Test #6
 *      ("publishing with missing required SEO fields shows inline errors")
 *      is therefore fixmed with a note — there is nothing to fail on.
 *
 *   6. The form's published state flips based on which primary button is
 *      clicked: "Save draft" → submit(false); "Publish" → submit(true). The
 *      payload key is literally `published: boolean`. There is no separate
 *      checkbox/switch; the buttons themselves drive the flag.
 *
 *   7. The error surface is an inline block rendered above the action buttons
 *      (red-tinted div, ink color var(--tassel)). Not a toast. We assert
 *      on that inline block for the 500 test.
 */

// ───────────────────────────────────────────
// Selectors
// ───────────────────────────────────────────

const TITLE_INPUT   = (p: Page) => p.getByPlaceholder('The title of the article');
const SLUG_INPUT    = (p: Page) => p.getByPlaceholder('auto-generated-from-title');
const EXCERPT_INPUT = (p: Page) => p.getByPlaceholder('A short summary shown in lists and cards');
// Tiptap v2 renders the contenteditable with .ProseMirror + .tiptap classes.
const TIPTAP        = (p: Page) => p.locator('.ProseMirror');
const EDITOR_WRAP   = (p: Page) => p.locator('.article-editor-content');
const SAVE_DRAFT    = (p: Page) => p.getByRole('button', { name: /^save draft$|^saving…$/i });
const PUBLISH_BTN   = (p: Page) => p.getByRole('button', { name: /^publish$|^publishing…$|save & keep published/i });
// article-editor.tsx toolbar buttons have textual content like "B", "I", "H2"
// (not accessible-friendly) plus a `title` attribute. Playwright's accessible-
// name calculation prefers text content over `title`, so selectors like
// `getByRole('button', { name: 'Bold' })` don't match "B". Address them by
// their `title` attribute — that's the stable, documented hook in the source.
const BOLD_BTN      = (p: Page) => p.locator('button[title="Bold"]');
const ITALIC_BTN    = (p: Page) => p.locator('button[title="Italic"]');
const H2_BTN        = (p: Page) => p.locator('button[title="Heading 2"]');
const BLOCKQUOTE    = (p: Page) => p.locator('button[title="Blockquote"]');
const LINK_BTN      = (p: Page) => p.locator('button[title="Link"]');

async function focusEditor(page: Page): Promise<void> {
  const editor = TIPTAP(page).first();
  await editor.click();
  // Clear any placeholder paragraph content so subsequent typing is deterministic.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
}

/**
 * Intercept the dashboard's /api/articles route at the browser layer and
 * capture the outbound payload. Returns a { getBody, getMethod } view that
 * polls can read. The responder is configurable per-test.
 */
function interceptArticlesApi(
  page: Page,
  responder: (route: Route) => Promise<void> | void,
): { get: () => { body: unknown; method: string | null } } {
  let capturedBody: unknown = null;
  let capturedMethod: string | null = null;
  page.route('**/api/articles**', async (route) => {
    const req = route.request();
    const method = req.method();
    capturedMethod = method;
    if (method === 'POST' || method === 'PATCH') {
      try {
        capturedBody = req.postDataJSON();
      } catch {
        capturedBody = req.postData();
      }
      await responder(route);
      return;
    }
    return route.continue();
  });
  return { get: () => ({ body: capturedBody, method: capturedMethod }) };
}

// ───────────────────────────────────────────
// Tests
// ───────────────────────────────────────────

test.describe('dashboard: article publish (storyblok-mocked CMS flow)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    // Block the Storyblok MAPI CDN base too (installApiMocks covers
    // api.storyblok.com; mapi.storyblok.com is a sibling host used by
    // the server for writes and by the edit-page SSR for reads). We
    // fulfill with 500 so a test that accidentally falls through to the
    // real server fails loudly rather than writing to real Storyblok.
    await page.route('**/mapi.storyblok.com/**', async (route) => {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'qa: real mapi call blocked' }),
      });
    });
  });

  test('new article form requires title (publish disabled until title filled)', async ({ page }) => {
    await page.goto('/articles/new');

    const titleInput = TITLE_INPUT(page);
    await expect(titleInput).toBeVisible();
    // Native `required` attribute is present on the title input.
    await expect(titleInput).toHaveAttribute('required', '');

    // Publish button is disabled until title is non-empty (see article-form.tsx
    // line 385: disabled={saving || !form.title.trim()}).
    const publish = PUBLISH_BTN(page).first();
    await expect(publish).toBeDisabled();

    // Fill title → publish enables.
    await titleInput.fill('QA Title');
    await expect(publish).toBeEnabled();

    // Clear title → publish disables again.
    await titleInput.fill('');
    await expect(publish).toBeDisabled();

    // Body (Tiptap) is NOT a HTML5-required field — document the asymmetry
    // for future maintainers. The only client-side gate is title.
  });

  test('Tiptap editor accepts bold, link, heading, blockquote input', async ({ page }) => {
    await page.goto('/articles/new');
    await TITLE_INPUT(page).fill('Tiptap Formatting Probe');

    // 1. Bold
    await focusEditor(page);
    await BOLD_BTN(page).click();
    await page.keyboard.type('bold text');
    await BOLD_BTN(page).click();
    await expect(EDITOR_WRAP(page).locator('strong', { hasText: 'bold text' })).toBeVisible();

    // 2. Heading 2 — new paragraph, toggle H2, type.
    await page.keyboard.press('Enter');
    await H2_BTN(page).click();
    await page.keyboard.type('my heading');
    await expect(EDITOR_WRAP(page).locator('h2', { hasText: 'my heading' })).toBeVisible();

    // 3. Link — set URL via the window.prompt() handler (see article-editor.tsx
    // handleLink). We intercept the native dialog via page.on('dialog') —
    // monkey-patching window.prompt is fragile because Playwright hooks the
    // native first and the patch can race the click. Register the listener
    // ONCE, before the click, and accept() with the URL as prompt text.
    await page.keyboard.press('Enter');
    // Toggle H2 off so we land back in a paragraph.
    await H2_BTN(page).click();
    await page.keyboard.type('linked word');
    // Select the typed text so setLink applies to a range.
    await page.keyboard.press('Shift+Home');

    const dialogHandler = (dialog: import('@playwright/test').Dialog) => {
      // Tiptap's handleLink passes the URL to setLink when prompt resolves
      // non-empty. Accept with a known URL so the `a[href=...]` assertion
      // below has a deterministic target.
      dialog.accept('https://example.test/a').catch(() => undefined);
    };
    page.on('dialog', dialogHandler);
    try {
      await LINK_BTN(page).click();
      await expect(EDITOR_WRAP(page).locator('a[href="https://example.test/a"]')).toBeVisible();
    } finally {
      page.off('dialog', dialogHandler);
    }

    // 4. Blockquote — stand-in for "code-block", which this editor does not
    // expose via toolbar (see file header #4). Exercises a block-level
    // toggle so the DOM assertion has teeth.
    await page.keyboard.press('Enter');
    await BLOCKQUOTE(page).click();
    await page.keyboard.type('quoted line');
    await expect(EDITOR_WRAP(page).locator('blockquote', { hasText: 'quoted line' })).toBeVisible();
  });

  test('save draft POSTs to /api/articles with correct payload (published=false)', async ({ page }) => {
    const cap = interceptArticlesApi(page, (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: '999999', slug: 'qa-mock' }),
      }),
    );

    await page.goto('/articles/new');
    await TITLE_INPUT(page).fill('QA TEST — Draft');

    // Fill body via Tiptap.
    await focusEditor(page);
    await page.keyboard.type('Test body content for draft.');

    // Click "Save draft" (the neutral, non-primary button).
    await SAVE_DRAFT(page).first().click();

    await expect.poll(() => cap.get().body, { timeout: 5_000 }).not.toBeNull();
    const body = cap.get().body as Record<string, unknown>;
    expect(cap.get().method).toBe('POST');
    expect(body.title).toBe('QA TEST — Draft');
    // Draft → published must be false (the server-action's sole responsibility
    // for distinguishing the two buttons — see article-form.tsx submit(false)).
    expect(body.published).toBe(false);
    // Slug auto-derived from title (article-form.tsx slugify()).
    expect(body.slug).toBe('qa-test-draft');
    // body_json shape — Tiptap emits a doc envelope.
    expect(body.body_json).toBeTruthy();
    expect((body.body_json as { type?: string })?.type).toBe('doc');
  });

  test('publish flips published=true in the payload', async ({ page }) => {
    const cap = interceptArticlesApi(page, (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: '999998', slug: 'qa-published' }),
      }),
    );

    await page.goto('/articles/new');
    await TITLE_INPUT(page).fill('QA TEST — Published');
    await focusEditor(page);
    await page.keyboard.type('Body for publish.');

    // Click "Publish" — must be the primary (navy) button, not "Save draft".
    await PUBLISH_BTN(page).first().click();

    await expect.poll(() => cap.get().body, { timeout: 5_000 }).not.toBeNull();
    const body = cap.get().body as Record<string, unknown>;
    expect(cap.get().method).toBe('POST');
    expect(body.title).toBe('QA TEST — Published');
    expect(body.published).toBe(true);
    // The form additionally stamps published_at on first-publish (submit()
    // line: publish && !form.published ? { published_at: ISO } : {}).
    expect(typeof body.published_at).toBe('string');
    expect((body.published_at as string).length).toBeGreaterThan(0);
  });

  test('slug field is editable on new form (manual edit overrides auto-slugify)', async ({ page }) => {
    await page.goto('/articles/new');

    // Fill title — slugify() runs automatically.
    await TITLE_INPUT(page).fill('Auto Title Seven');
    await expect(SLUG_INPUT(page)).toHaveValue('auto-title-seven');

    // Now manually edit the slug. Once touched, it should NOT be overwritten
    // by further title edits (slugManuallyEdited flag flips true).
    await SLUG_INPUT(page).fill('custom-slug-qa');
    await expect(SLUG_INPUT(page)).toHaveValue('custom-slug-qa');

    // Further title change should NOT clobber the manually-edited slug.
    await TITLE_INPUT(page).fill('Another Title');
    await expect(SLUG_INPUT(page)).toHaveValue('custom-slug-qa');

    // Slug input lowercases + strips to [a-z0-9-] per the form's onChange.
    await SLUG_INPUT(page).fill('UPPER Case!!');
    await expect(SLUG_INPUT(page)).toHaveValue('uppercase');
  });

  test.fixme(
    'publishing with missing required SEO fields shows inline errors',
    async () => {
      // No SEO field is `required` in article-form.tsx. All three
      // (seo_title, seo_description, seo_og_image) are optional overrides
      // inside a collapsible "SEO settings" section. There is no validator
      // to assert against. If SEO requireds are added later, this test
      // should be un-fixmed and wired to the real validator.
    },
  );

  test('Storyblok 500 surfaces a user-visible error, no crash', async ({ page }) => {
    // Intercept /api/articles and return 500 with a JSON error body — the
    // same shape the route.ts handler returns when mapi throws.
    await page.route('**/api/articles**', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Storyblok rejected the story payload (QA simulated).' }),
        });
      }
      return route.continue();
    });

    // Fail the test on any uncaught page error — surfaces a crash beyond
    // the inline error state.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto('/articles/new');
    await TITLE_INPUT(page).fill('QA — 500 path');
    await focusEditor(page);
    await page.keyboard.type('Body that will fail to save.');

    await SAVE_DRAFT(page).first().click();

    // The inline error block renders `{error}` text. article-form.tsx line
    // 356 styles it with var(--tassel) (red). We assert the server-sent
    // error body text appears somewhere on the page.
    await expect(page.getByText(/Storyblok rejected the story payload/i)).toBeVisible({
      timeout: 5_000,
    });

    // The form must not crash — the "Save draft" button must still be in the
    // DOM and interactive (re-enabled by setSaving(false) in the catch path).
    await expect(SAVE_DRAFT(page).first()).toBeEnabled();

    // And no uncaught errors made it to the window.
    expect(pageErrors.map((e) => e.message)).toEqual([]);
  });
});
