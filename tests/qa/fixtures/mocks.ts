import type { Page } from '@playwright/test';

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/**
 * Intercepts all outbound calls the dashboard might make to paid/public APIs
 * so QA test runs can't burn budget or post publicly. Call this in
 * `test.beforeEach` for every dashboard-side spec. Website-side specs
 * generally don't need it because the website doesn't make outbound write
 * calls from the browser.
 */
export async function installApiMocks(page: Page): Promise<void> {
  // Storyblok Management API (dashboard writes) and CDN (website reads).
  // Note: website SSR reads from Storyblok CDN happen server-side in Next.js,
  // not from the browser, so page.route() doesn't intercept them. That's fine —
  // CMS write flows are tested from the dashboard side here.
  await page.route('**/api.storyblok.com/v1/spaces/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ stories: [] }),
      });
    }
    return route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ story: { id: 999999, slug: 'qa-mock', published: false } }),
    });
  });

  // Anthropic — return a canned image block for AI image gen.
  await page.route('**/api.anthropic.com/**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_qa', type: 'message', role: 'assistant',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: ONE_PX_PNG_BASE64 },
        }],
      }),
    });
  });

  // Kie.ai — create job (POST) then poll completion (GET).
  await page.route('**/api.kie.ai/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' && url.includes('/jobs')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'qa-kie-123', status: 'queued' }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: 'qa-kie-123', status: 'completed',
        video_url: 'https://example.test/qa.mp4',
      }),
    });
  });

  // Buffer v2 GraphQL — createUpdate mutation.
  await page.route('**/api.bufferapp.com/**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { createUpdate: { id: 'qa-buf-123', status: 'scheduled' } } }),
    });
  });

  // YouTube — upload + v3 stats.
  await page.route('**/googleapis.com/upload/youtube/**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'qa-yt-123', status: { uploadStatus: 'uploaded' } }),
    });
  });
  await page.route('**/googleapis.com/youtube/v3/**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 'qa-yt-123', statistics: { viewCount: '42', likeCount: '7' } }] }),
    });
  });
}
