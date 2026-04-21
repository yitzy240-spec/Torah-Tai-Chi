import { test, expect } from '@playwright/test';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const WEBSITE_URL = process.env.WEBSITE_URL;

async function runLighthouse(url: string) {
  const chrome = await launch({ chromeFlags: ['--headless=new'] });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    return result;
  } finally {
    await chrome.kill();
  }
}

test.describe('lighthouse budgets', () => {
  let articlePath: string | null = null;
  let videoPath: string | null = null;

  test.beforeAll(async ({ request }) => {
    if (!WEBSITE_URL) return;
    try {
      const resp = await request.get(`${WEBSITE_URL}/sitemap.xml`);
      const xml = await resp.text();
      const articleMatch = xml.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
      const videoMatch   = xml.match(/<loc>[^<]*\/videos\/([a-z0-9-]+)<\/loc>/);
      if (articleMatch) articlePath = `/articles/${articleMatch[1]}`;
      if (videoMatch)   videoPath   = `/videos/${videoMatch[1]}`;
    } catch { /* skip dynamic */ }
  });

  test('homepage budgets', async () => {
    test.setTimeout(120_000);
    test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
    const result = await runLighthouse(`${WEBSITE_URL}/`);
    const scores = result?.lhr.categories;
    expect(scores?.performance.score ?? 0).toBeGreaterThanOrEqual(0.80);
    expect(scores?.accessibility.score ?? 0).toBeGreaterThanOrEqual(0.90);
    expect(scores?.seo.score ?? 0).toBeGreaterThanOrEqual(0.90);
  });

  test('article detail budgets', async () => {
    test.setTimeout(120_000);
    test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
    test.skip(!articlePath, 'No article slug resolved from sitemap');
    const result = await runLighthouse(`${WEBSITE_URL}${articlePath}`);
    const scores = result?.lhr.categories;
    expect(scores?.performance.score ?? 0).toBeGreaterThanOrEqual(0.80);
    expect(scores?.accessibility.score ?? 0).toBeGreaterThanOrEqual(0.90);
    expect(scores?.seo.score ?? 0).toBeGreaterThanOrEqual(0.90);
  });

  test('video detail budgets', async () => {
    test.setTimeout(120_000);
    test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
    test.skip(!videoPath, 'No video slug resolved from sitemap');
    const result = await runLighthouse(`${WEBSITE_URL}${videoPath}`);
    const scores = result?.lhr.categories;
    expect(scores?.performance.score ?? 0).toBeGreaterThanOrEqual(0.80);
    expect(scores?.accessibility.score ?? 0).toBeGreaterThanOrEqual(0.90);
    expect(scores?.seo.score ?? 0).toBeGreaterThanOrEqual(0.90);
  });
});
