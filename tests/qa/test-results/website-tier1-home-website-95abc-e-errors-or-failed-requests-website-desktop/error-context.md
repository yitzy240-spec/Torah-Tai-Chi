# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: website\tier1\home.spec.ts >> website: home >> no console errors or failed requests
- Location: website\tier1\home.spec.ts:56:3

# Error details

```
Error: [
  "GET https://torah-tai-chi.vercel.app/articles?_rsc=p37cr — net::ERR_ABORTED"
]

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "GET https://torah-tai-chi.vercel.app/articles?_rsc=p37cr — net::ERR_ABORTED",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation [ref=e2]:
    - link "Torah Tai Chi Torah Tai Chi" [ref=e3] [cursor=pointer]:
      - /url: /
      - img "Torah Tai Chi" [ref=e4]
      - generic [ref=e5]: Torah Tai Chi
    - generic [ref=e6]:
      - generic [ref=e7]:
        - link "Home" [ref=e8] [cursor=pointer]:
          - /url: /
        - link "Videos" [ref=e9] [cursor=pointer]:
          - /url: /videos
        - link "Articles" [ref=e10] [cursor=pointer]:
          - /url: /articles
        - link "About" [ref=e11] [cursor=pointer]:
          - /url: /about
      - generic [ref=e12]:
        - link "TikTok" [ref=e13] [cursor=pointer]:
          - /url: https://tiktok.com/@torahtaichi
          - img [ref=e14]
        - link "YouTube" [ref=e16] [cursor=pointer]:
          - /url: https://youtube.com/@torahtaichi
          - img [ref=e17]
        - link "Instagram" [ref=e19] [cursor=pointer]:
          - /url: https://instagram.com/torahtaichi
          - img [ref=e20]
  - generic [ref=e22]:
    - generic [ref=e23]:
      - generic [ref=e24]: Weekly teachings
      - heading "Where ancient wisdom meets the body." [level=1] [ref=e26]:
        - text: Where ancient wisdom
        - emphasis [ref=e27]: meets the body.
      - paragraph [ref=e28]: Torah Tai Chi fuses the weekly parsha with the internal arts — rooting, yielding, song — to find the place where Jewish wisdom and the body’s intelligence say the same thing.
      - generic [ref=e29]:
        - link "Play Acharei Mot teaching" [ref=e30] [cursor=pointer]:
          - /url: /videos/acharei-mot
          - text: Play Acharei Mot teaching
          - generic [ref=e31]: →
        - link "Explore all parshiot" [ref=e32] [cursor=pointer]:
          - /url: /videos
    - generic [ref=e33]:
      - generic [ref=e34]: "This week: Acharei Mot אחרי מות"
      - img [ref=e37] [cursor=pointer]
      - generic [ref=e39]:
        - generic [ref=e40]: Acharei Mot
        - generic [ref=e41]: ·
        - generic [ref=e42]: Weight into Earth
  - generic [ref=e46]: 松 rooted release, not collapse · the craft compounds 勁
  - generic [ref=e47]:
    - generic [ref=e48]:
      - heading "Recent teachings" [level=2] [ref=e49]
      - link "All 54 parshiot →" [ref=e50] [cursor=pointer]:
        - /url: /videos
    - generic [ref=e51]:
      - link "Bereishit — Torah Tai Chi weekly teaching 0:45 בראשית Bereishit Genesis ·" [ref=e52] [cursor=pointer]:
        - /url: /videos/bereishit
        - generic [ref=e53]:
          - img "Bereishit — Torah Tai Chi weekly teaching" [ref=e54]
          - text: 0:45
        - generic [ref=e55]: בראשית
        - generic [ref=e56]: Bereishit
        - generic [ref=e57]: Genesis ·
      - link "Noach — Torah Tai Chi weekly teaching 0:45 נח Noach Genesis ·" [ref=e58] [cursor=pointer]:
        - /url: /videos/noach
        - generic [ref=e59]:
          - img "Noach — Torah Tai Chi weekly teaching" [ref=e60]
          - text: 0:45
        - generic [ref=e61]: נח
        - generic [ref=e62]: Noach
        - generic [ref=e63]: Genesis ·
      - link "Lech Lecha — Torah Tai Chi weekly teaching 0:45 לך לך Lech Lecha Genesis ·" [ref=e64] [cursor=pointer]:
        - /url: /videos/lech-lecha
        - generic [ref=e65]:
          - img "Lech Lecha — Torah Tai Chi weekly teaching" [ref=e66]
          - text: 0:45
        - generic [ref=e67]: לך לך
        - generic [ref=e68]: Lech Lecha
        - generic [ref=e69]: Genesis ·
      - link "Vayeira — Torah Tai Chi weekly teaching 0:45 Vayeira Genesis ·" [ref=e70] [cursor=pointer]:
        - /url: /videos/vayeira
        - generic [ref=e71]:
          - img "Vayeira — Torah Tai Chi weekly teaching" [ref=e72]
          - text: 0:45
        - generic [ref=e73]: Vayeira
        - generic [ref=e74]: Genesis ·
  - generic [ref=e75]:
    - generic [ref=e76]:
      - heading "From the writings" [level=2] [ref=e77]
      - link "All articles →" [ref=e78] [cursor=pointer]:
        - /url: /articles
    - generic [ref=e79]:
      - link "Essay Why the Body Knows Before the Mind There’s a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah. April 12, 2026 · 6 min read" [ref=e80] [cursor=pointer]:
        - /url: /articles/why-the-body-knows
        - generic [ref=e81]: Essay
        - heading "Why the Body Knows Before the Mind" [level=3] [ref=e82]
        - paragraph [ref=e83]: There’s a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah.
        - generic [ref=e84]: April 12, 2026 · 6 min read
      - 'link "Teaching Song and Anavah: The Shared Root of Release The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself. April 4, 2026 · 8 min read" [ref=e85] [cursor=pointer]':
        - /url: /articles/song-and-anavah
        - generic [ref=e86]: Teaching
        - 'heading "Song and Anavah: The Shared Root of Release" [level=3] [ref=e87]'
        - paragraph [ref=e88]: The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself.
        - generic [ref=e89]: April 4, 2026 · 8 min read
      - 'link "Reflection What Shabbat Taught About Stillness in Motion For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn’t absence of movement. March 28, 2026 · 5 min read" [ref=e90] [cursor=pointer]':
        - /url: /articles/shabbat-stillness-in-motion
        - generic [ref=e91]: Reflection
        - heading "What Shabbat Taught About Stillness in Motion" [level=3] [ref=e92]
        - paragraph [ref=e93]: "For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn’t absence of movement."
        - generic [ref=e94]: March 28, 2026 · 5 min read
  - generic [ref=e95]:
    - img "Torah Tai Chi" [ref=e97]
    - generic [ref=e98]:
      - heading "The practice between traditions." [level=2] [ref=e99]
      - paragraph [ref=e100]: "Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week’s parsha carries a teaching about character, restraint, holiness — and each of those teachings has a parallel in the body: rooting, yielding, releasing tension without collapsing structure."
  - contentinfo [ref=e101]:
    - generic [ref=e102]:
      - generic [ref=e103]:
        - link "Torah Tai Chi home" [ref=e104] [cursor=pointer]:
          - /url: /
          - img "Torah Tai Chi" [ref=e105]
          - generic [ref=e106]: Torah Tai Chi
        - paragraph [ref=e107]: Where ancient wisdom meets the body. A weekly practice, in under a minute.
      - navigation "Footer" [ref=e108]:
        - generic [ref=e109]: Explore
        - link "Home" [ref=e110] [cursor=pointer]:
          - /url: /
        - link "Videos" [ref=e111] [cursor=pointer]:
          - /url: /videos
        - link "Articles" [ref=e112] [cursor=pointer]:
          - /url: /articles
        - link "About" [ref=e113] [cursor=pointer]:
          - /url: /about
      - generic [ref=e114]:
        - generic [ref=e115]: Connect
        - link "hello@torahtaichi.com" [ref=e116] [cursor=pointer]:
          - /url: mailto:hello@torahtaichi.com
        - generic [ref=e117]:
          - link "TikTok" [ref=e118] [cursor=pointer]:
            - /url: https://tiktok.com/@torahtaichi
            - img [ref=e119]
          - link "YouTube" [ref=e121] [cursor=pointer]:
            - /url: https://youtube.com/@torahtaichi
            - img [ref=e122]
          - link "Instagram" [ref=e124] [cursor=pointer]:
            - /url: https://instagram.com/torahtaichi
            - img [ref=e125]
          - link "Facebook" [ref=e127] [cursor=pointer]:
            - /url: https://facebook.com/torahtaichi
            - img [ref=e128]
    - generic [ref=e130]:
      - generic [ref=e131]: © 2026 Torah Tai Chi · torahtaichi.com
      - generic [ref=e132]:
        - link "About" [ref=e133] [cursor=pointer]:
          - /url: /about
        - link "Contact" [ref=e134] [cursor=pointer]:
          - /url: mailto:hello@torahtaichi.com
  - alert [ref=e135]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | // Public website spec — no auth, no API mocks (the browser never hits paid
  4  | // APIs on the public site; data comes from Storyblok CDN + Supabase, which
  5  | // the preview URL already reaches server-side).
  6  | 
  7  | test.describe('website: home', () => {
  8  |   test('hero renders brand + tagline', async ({ page }) => {
  9  |     await page.goto('/');
  10 |     // The <h1> is built from site-content.ts (`home.hero.title` — default
  11 |     // "Where ancient wisdom meets the body."). A loose brand/body match is
  12 |     // more resilient to CMS copy tweaks than matching the h1 exactly.
  13 |     await expect(page.locator('body')).toContainText(/torah tai chi/i);
  14 |   });
  15 | 
  16 |   test('latest content sections have article and video cards', async ({ page }) => {
  17 |     await page.goto('/');
  18 |     // VideoCard + ArticleCard both wrap in <Link> → <a href="/videos/..."> and
  19 |     // <a href="/articles/...">. Use broad hrefs so this survives layout changes.
  20 |     await expect(page.locator('a[href^="/videos/"]').first()).toBeVisible();
  21 |     await expect(page.locator('a[href^="/articles/"]').first()).toBeVisible();
  22 |   });
  23 | 
  24 |   test('no qa_seed-tagged rows leak to the page', async ({ page }) => {
  25 |     await page.goto('/');
  26 |     const html = await page.content();
  27 |     // Guards the qa_seed filter in parshiot.ts / articles pipeline. The
  28 |     // dashboard seeds data with titles prefixed "QA TEST —" and slugs
  29 |     // starting with "qa-test-"; both should never appear on the public site.
  30 |     expect(html).not.toMatch(/qa-test-|QA TEST —/);
  31 |   });
  32 | 
  33 |   test('essential metadata is present', async ({ page }) => {
  34 |     await page.goto('/');
  35 |     // <title> template is "%s · Torah Tai Chi" with default "Torah Tai Chi —
  36 |     // Where Ancient Wisdom Meets the Body" (see app/layout.tsx).
  37 |     await expect(page).toHaveTitle(/torah tai chi/i);
  38 |     for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
  39 |       const meta = page.locator(`meta[property="${prop}"]`);
  40 |       await expect(meta).toHaveAttribute('content', /.+/);
  41 |     }
  42 |     await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /.+/);
  43 |   });
  44 | 
  45 |   test('mobile viewport has no horizontal scroll', async ({ page, viewport }) => {
  46 |     test.skip(!viewport || viewport.width > 600, 'mobile-only');
  47 |     await page.goto('/');
  48 |     // 1px tolerance for subpixel rounding in the browser layout engine.
  49 |     const overflow = await page.evaluate(() => ({
  50 |       sw: document.documentElement.scrollWidth,
  51 |       cw: document.documentElement.clientWidth,
  52 |     }));
  53 |     expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  54 |   });
  55 | 
  56 |   test('no console errors or failed requests', async ({ page }) => {
  57 |     const consoleErrors: string[] = [];
  58 |     const requestFailures: string[] = [];
  59 |     page.on('console', (msg) => {
  60 |       if (msg.type() === 'error') consoleErrors.push(msg.text());
  61 |     });
  62 |     page.on('requestfailed', (req) => {
  63 |       requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  64 |     });
  65 |     await page.goto('/');
  66 |     await page.waitForLoadState('networkidle');
  67 |     expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
> 68 |     expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
     |                                                                       ^ Error: [
  69 |   });
  70 | });
  71 | 
```