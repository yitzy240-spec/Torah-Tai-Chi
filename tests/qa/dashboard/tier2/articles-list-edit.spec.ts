import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /articles (list) and /articles/[id]/edit.
 *
 * Source-driven notes:
 *   - dashboard/src/app/articles/page.tsx is a server component; it calls
 *     `listArticles()` which hits Storyblok Management API in the Node
 *     runtime. `page.route()` cannot intercept that upstream fetch. On
 *     failure the page renders "Could not load articles: …". We don't
 *     force the failure branch — we assert the page always renders the
 *     h1 "Articles." and the + New article CTA.
 *   - dashboard/src/app/articles/[id]/edit/page.tsx is a server component
 *     that resolves its data via `mapiGetStory(Number(id))` → also a
 *     server-side Storyblok fetch. Because it's server-side, the plan's
 *     suggestion of `page.route('**\/api/articles/**')` to inject a canned
 *     story does NOT work — that dashboard API path only handles
 *     POST/PATCH/DELETE, not GET. Populating the edit form without
 *     hitting Storyblok is not possible in the browser-side test
 *     harness. The "form populates" test is therefore fixmed with a
 *     full explanation.
 *   - The edit form itself (dashboard/src/components/article-form.tsx)
 *     PATCHes `/api/articles/[id]` on publish/save — that IS browser-side
 *     and IS interceptable. But we can't reach the form without a real
 *     story id in the URL; the route notFound()s if the story isn't an
 *     article component. Same blocker. "Edit: PATCH on save" also fixmed.
 *   - No client-side status filter on the list page — status is a visual
 *     column only (jade dot vs. grey dot). "Filter by status narrows
 *     list" has no UI to exercise.
 *   - No delete UI on the list page — articles/[id]/edit has no delete
 *     button either. DELETE /api/articles/[id] exists in the route but
 *     is not wired to a visible control. "Delete removes from list"
 *     cannot be exercised.
 *
 * FINDING: the Articles list surface has no search, no status filter,
 * no delete action wired into UI. If any of those land, unfixme the
 * corresponding test.
 */

test.describe('dashboard: articles list + edit (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('articles list renders heading + new-article CTA', async ({ page }) => {
    await page.goto('/articles');

    // H1 copy: "Articles." (period in a nested <em>).
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
    ).toContainText(/articles/i);

    // The "+ New article" link is always rendered — regardless of list
    // length or Storyblok fetch success. It's an <a href="/articles/new">.
    const cta = page.getByRole('link', { name: /new article/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/articles/new');
  });

  test('articles list renders either rows, empty-state, or error copy', async ({
    page,
  }) => {
    await page.goto('/articles');

    // Exactly ONE of these three branches must be present:
    //   1. Table header row (when articles.length > 0) → contains
    //      "Title" + "Category" + "Status" + "Updated" + "Actions"
    //   2. Empty-state dashed box with "No articles yet. Write your first one."
    //   3. Error copy "Could not load articles: <msg>"
    const rowHeader = page.getByText(/^title$/i, { exact: false }).first();
    const empty = page.getByText(/no articles yet/i);
    const errFallback = page.getByText(/could not load articles/i);

    const [headerCount, emptyCount, errCount] = await Promise.all([
      rowHeader.count(),
      empty.count(),
      errFallback.count(),
    ]);

    expect(headerCount + emptyCount + errCount).toBeGreaterThanOrEqual(1);

    test.info().annotations.push({
      type: 'note',
      description: errCount
        ? 'Storyblok listArticles() failed server-side; rendered the error fallback.'
        : emptyCount
          ? 'No articles in this env — empty-state rendered.'
          : 'Articles rendered.',
    });
  });

  test('articles list has a "new article" CTA that navigates to /articles/new', async ({
    page,
  }) => {
    await page.goto('/articles');

    const cta = page.getByRole('link', { name: /new article/i }).first();
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/articles\/new$/);
  });

  test('filter by status narrows list', async () => {
    // There is no client-side status filter on /articles — status is
    // rendered as a coloured dot in a column, not a filter pill. The
    // plan's "status filter" test has no UI counterpart in current
    // source. Unfixme when a status filter ships.
    test.fixme(
      true,
      'No status filter UI in dashboard/src/app/articles/page.tsx today (status is a read-only column). Revisit when filter ships.',
    );
  });

  test('edit existing article: page loads and populates form fields', async () => {
    // dashboard/src/app/articles/[id]/edit/page.tsx calls mapiGetStory()
    // in the Node.js runtime — upstream Storyblok fetch is NOT
    // `page.route()`-able from the browser. The dashboard does not
    // expose a GET /api/articles/[id] route we could intercept instead;
    // only PATCH and DELETE are handled. So there is no way to populate
    // the edit form in a browser-side test without hitting real
    // Storyblok. Revisit if we add a test-only env flag or an MSW
    // server-side hook.
    test.fixme(
      true,
      'mapiGetStory() is server-side (Node.js); /api/articles/[id] has no GET. Cannot populate edit form without hitting real Storyblok. Tracked for Phase I — see analytics.spec.ts / settings/seo test-fixmes with the same server-side-fetch blocker.',
    );
  });

  test('edit: title change triggers PATCH when Save clicked', async () => {
    // Same blocker as above: we can't reach the edit form without a real
    // Storyblok story ID, and we don't have a way to inject one from
    // the browser side. The PATCH interception logic (page.route
    // '**\/api/articles/**' filtering method === 'PATCH') would work IF
    // we could reach the form — we can't.
    test.fixme(
      true,
      'Blocked on the same Storyblok server-side fetch as the populate test above. PATCH interception via page.route() is fine in principle — unfixme when form reachability lands.',
    );
  });

  test('delete article (non-published) removes from list', async () => {
    // No delete UI wired into /articles or /articles/[id]/edit in
    // current source. DELETE /api/articles/[id] exists but there's no
    // button calling it. Until a delete control ships, this has
    // nothing to exercise.
    test.fixme(
      true,
      'No delete UI in articles list or edit page. DELETE /api/articles/[id] exists but is unwired. Revisit when a delete control ships.',
    );
  });
});
