import { chromium, type Browser, type BrowserContext } from 'playwright';
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installApiMocks } from '../fixtures/mocks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env.qa') });

type Viewport = { name: 'desktop' | 'mobile'; width: number; height: number };
const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844 },
];

interface PageGroup {
  surface: 'dashboard' | 'website';
  tier: 1 | 2 | 3;
  paths: string[];
}

const PAGES: PageGroup[] = [
  { surface: 'dashboard', tier: 1, paths: ['/', '/compose', '/channels'] },
  { surface: 'dashboard', tier: 2, paths: ['/analytics', '/calendar', '/videos', '/settings', '/site-content', '/articles'] },
  { surface: 'dashboard', tier: 3, paths: ['/help'] },
  { surface: 'website',   tier: 1, paths: ['/'] },  // article/video detail added dynamically
  { surface: 'website',   tier: 2, paths: ['/about', '/book', '/articles', '/videos'] },
];

async function resolveDynamicWebsitePaths(websiteUrl: string): Promise<string[]> {
  const res: string[] = [];
  try {
    const response = await fetch(`${websiteUrl}/sitemap.xml`);
    if (response.ok) {
      const xml = await response.text();
      const articleMatch = xml.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
      const videoMatch   = xml.match(/<loc>[^<]*\/videos\/([a-z0-9-]+)<\/loc>/);
      if (articleMatch) res.push(`/articles/${articleMatch[1]}`);
      if (videoMatch)   res.push(`/videos/${videoMatch[1]}`);
    }
  } catch { /* ignore */ }
  return res;
}

async function captureGroup(
  browser: Browser,
  group: PageGroup,
  baseUrl: string,
  authenticated: boolean,
): Promise<void> {
  const ctx: BrowserContext = await browser.newContext(
    authenticated ? { storageState: path.join(process.cwd(), 'storageState.json') } : {}
  );
  const page = await ctx.newPage();
  if (authenticated) await installApiMocks(page);

  for (const p of group.paths) {
    for (const vp of VIEWPORTS) {
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${baseUrl}${p}`, { waitUntil: 'networkidle', timeout: 30_000 });
        const outDir = path.join('shots', group.surface, `tier${group.tier}`);
        await fs.mkdir(outDir, { recursive: true });
        const slug = p.replace(/^\//, '').replace(/\W+/g, '_') || 'root';
        const outPath = path.join(outDir, `${slug}-${vp.name}.png`);
        await page.screenshot({ path: outPath, fullPage: true });
        console.log(`[capture] ${group.surface}/${p}@${vp.name} → ${outPath}`);
      } catch (err) {
        console.warn(`[capture] failed ${group.surface}/${p}@${vp.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await ctx.close();
}

(async () => {
  const DASHBOARD_URL = process.env.DASHBOARD_URL;
  const WEBSITE_URL   = process.env.WEBSITE_URL;
  if (!DASHBOARD_URL || !WEBSITE_URL) throw new Error('Missing DASHBOARD_URL or WEBSITE_URL in .env.qa');

  const dynamicPaths = await resolveDynamicWebsitePaths(WEBSITE_URL);
  const websiteTier1 = PAGES.find(g => g.surface === 'website' && g.tier === 1)!;
  websiteTier1.paths.push(...dynamicPaths);

  const browser = await chromium.launch();
  try {
    for (const group of PAGES) {
      const baseUrl = group.surface === 'dashboard' ? DASHBOARD_URL : WEBSITE_URL;
      const authenticated = group.surface === 'dashboard';
      await captureGroup(browser, group, baseUrl, authenticated);
    }
  } finally {
    await browser.close();
  }
  console.log('[capture] complete');
})();
