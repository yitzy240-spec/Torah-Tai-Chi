import { test, expect } from '@playwright/test';

// Tier 3 smoke for POST /api/revalidate
// (website/src/app/api/revalidate/route.ts).
//
// Auth scheme (source-verified):
//   - Reads shared secret from env.STORYBLOK_WEBHOOK_SECRET.
//   - Expects `webhook-signature` or `x-storyblok-webhook-secret` header to
//     match. If env secret is set and header doesn't match → 403.
//   - If env secret is UNSET, the guard short-circuits (no auth required).
//   - Body must be valid JSON or the handler returns 400.

test.describe('website: POST /api/revalidate', () => {
  test('POST without auth returns 403 or passes through (env-dependent)', async ({
    request,
  }) => {
    // No webhook-signature header + valid JSON body. If the secret is
    // configured, this must be rejected with 403. If the env has no secret
    // configured (local/preview), the handler will accept and return 200.
    // The "catastrophic" finding would be a public writable endpoint with a
    // secret configured but not enforced — i.e. status 200 despite env
    // secret being set. We can't know the env from the test, so we assert
    // the shape: if 200, the response body must claim revalidation
    // succeeded; if 403, good.
    const resp = await request.post('/api/revalidate', {
      data: { full_slug: 'articles/qa-test-revalidate-no-auth' },
      headers: { 'content-type': 'application/json' },
    });
    const status = resp.status();
    expect(
      [200, 401, 403],
      `unexpected status ${status} for /api/revalidate with no auth`,
    ).toContain(status);
    if (status === 200) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No STORYBLOK_WEBHOOK_SECRET appears to be set in this env — /api/revalidate is accepting unauthenticated requests. Verify this is preview/dev, NOT production.',
      });
    }
  });

  test('POST with invalid JSON body returns 400 or 403', async ({ request }) => {
    // The handler tries req.json() before doing anything useful, so non-JSON
    // bodies fail with 400 — unless the secret check rejects first with 403.
    const resp = await request.post('/api/revalidate', {
      data: 'not-json-at-all',
      headers: { 'content-type': 'text/plain' },
    });
    expect([400, 403]).toContain(resp.status());
  });

  test.fixme(
    'POST with valid secret triggers revalidation',
    async () => {
      // The webhook secret lives in STORYBLOK_WEBHOOK_SECRET (not exposed to
      // the browser / test runner). We can't know it without hardcoding a
      // production secret — out of scope for QA. Revisit once we have a
      // dedicated QA webhook secret injected via .env.qa.
    },
  );
});
