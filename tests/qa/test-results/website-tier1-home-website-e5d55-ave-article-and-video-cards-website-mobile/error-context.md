# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: website\tier1\home.spec.ts >> website: home >> latest content sections have article and video cards
- Location: website\tier1\home.spec.ts:16:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('a[href^="/videos/"]').first()
Expected: visible
Received: hidden
Timeout:  10000ms

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('a[href^="/videos/"]').first()
    13 × locator resolved to <a class="btn btn-primary" href="/videos/acharei-mot">…</a>
       - unexpected value "hidden"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation [ref=e2]:
    - link "Torah Tai Chi" [ref=e3]:
      - /url: /
      - img "Torah Tai Chi" [ref=e4]
    - button "Open menu" [ref=e6] [cursor=pointer]:
      - img [ref=e7]
  - generic [ref=e8]:
    - generic [ref=e9]:
      - generic [ref=e10]: Weekly teachings
      - heading "Where ancient wisdom meets the body." [level=1] [ref=e12]:
        - text: Where ancient wisdom
        - emphasis [ref=e13]: meets the body.
      - paragraph [ref=e14]: Torah Tai Chi fuses the weekly parsha with the internal arts — rooting, yielding, song — to find the place where Jewish wisdom and the body’s intelligence say the same thing.
    - generic [ref=e15]:
      - generic [ref=e16]: "This week: Acharei Mot אחרי מות"
      - img [ref=e19] [cursor=pointer]
      - generic [ref=e21]:
        - generic [ref=e22]: Acharei Mot
        - generic [ref=e23]: ·
        - generic [ref=e24]: Weight into Earth
    - generic [ref=e25]:
      - link "Play Acharei Mot teaching" [ref=e26] [cursor=pointer]:
        - /url: /videos/acharei-mot
        - text: Play Acharei Mot teaching
        - generic [ref=e27]: →
      - link "Explore all parshiot" [ref=e28]:
        - /url: /videos
  - generic [ref=e32]: 松 rooted release, not collapse · the craft compounds 勁
  - generic [ref=e33]:
    - generic [ref=e34]:
      - heading "Recent teachings" [level=2] [ref=e35]
      - link "All 54 parshiot →" [ref=e36]:
        - /url: /videos
    - generic [ref=e37]:
      - link "Bereishit — Torah Tai Chi weekly teaching 0:45 בראשית Bereishit Genesis ·" [ref=e38]:
        - /url: /videos/bereishit
        - generic [ref=e39]:
          - img "Bereishit — Torah Tai Chi weekly teaching" [ref=e40]
          - text: 0:45
        - generic [ref=e41]: בראשית
        - generic [ref=e42]: Bereishit
        - generic [ref=e43]: Genesis ·
      - link "Noach — Torah Tai Chi weekly teaching 0:45 נח Noach Genesis ·" [ref=e44]:
        - /url: /videos/noach
        - generic [ref=e45]:
          - img "Noach — Torah Tai Chi weekly teaching" [ref=e46]
          - text: 0:45
        - generic [ref=e47]: נח
        - generic [ref=e48]: Noach
        - generic [ref=e49]: Genesis ·
      - link "Lech Lecha — Torah Tai Chi weekly teaching 0:45 לך לך Lech Lecha Genesis ·" [ref=e50]:
        - /url: /videos/lech-lecha
        - generic [ref=e51]:
          - img "Lech Lecha — Torah Tai Chi weekly teaching" [ref=e52]
          - text: 0:45
        - generic [ref=e53]: לך לך
        - generic [ref=e54]: Lech Lecha
        - generic [ref=e55]: Genesis ·
      - link "Vayeira — Torah Tai Chi weekly teaching 0:45 Vayeira Genesis ·" [ref=e56]:
        - /url: /videos/vayeira
        - generic [ref=e57]:
          - img "Vayeira — Torah Tai Chi weekly teaching" [ref=e58]
          - text: 0:45
        - generic [ref=e59]: Vayeira
        - generic [ref=e60]: Genesis ·
  - generic [ref=e61]:
    - generic [ref=e62]:
      - heading "From the writings" [level=2] [ref=e63]
      - link "All articles →" [ref=e64]:
        - /url: /articles
    - generic [ref=e65]:
      - link "Essay Why the Body Knows Before the Mind There’s a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah. April 12, 2026 · 6 min read" [ref=e66]:
        - /url: /articles/why-the-body-knows
        - generic [ref=e67]: Essay
        - heading "Why the Body Knows Before the Mind" [level=3] [ref=e68]
        - paragraph [ref=e69]: There’s a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah.
        - generic [ref=e70]: April 12, 2026 · 6 min read
      - 'link "Teaching Song and Anavah: The Shared Root of Release The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself. April 4, 2026 · 8 min read" [ref=e71]':
        - /url: /articles/song-and-anavah
        - generic [ref=e72]: Teaching
        - 'heading "Song and Anavah: The Shared Root of Release" [level=3] [ref=e73]'
        - paragraph [ref=e74]: The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself.
        - generic [ref=e75]: April 4, 2026 · 8 min read
      - 'link "Reflection What Shabbat Taught About Stillness in Motion For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn’t absence of movement. March 28, 2026 · 5 min read" [ref=e76]':
        - /url: /articles/shabbat-stillness-in-motion
        - generic [ref=e77]: Reflection
        - heading "What Shabbat Taught About Stillness in Motion" [level=3] [ref=e78]
        - paragraph [ref=e79]: "For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn’t absence of movement."
        - generic [ref=e80]: March 28, 2026 · 5 min read
  - generic [ref=e81]:
    - img "Torah Tai Chi" [ref=e83]
    - generic [ref=e84]:
      - heading "The practice between traditions." [level=2] [ref=e85]
      - paragraph [ref=e86]: "Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week’s parsha carries a teaching about character, restraint, holiness — and each of those teachings has a parallel in the body: rooting, yielding, releasing tension without collapsing structure."
  - contentinfo [ref=e87]:
    - generic [ref=e88]:
      - generic [ref=e89]:
        - link "Torah Tai Chi home" [ref=e90]:
          - /url: /
          - img "Torah Tai Chi" [ref=e91]
          - generic [ref=e92]: Torah Tai Chi
        - paragraph [ref=e93]: Where ancient wisdom meets the body. A weekly practice, in under a minute.
      - navigation "Footer" [ref=e94]:
        - generic [ref=e95]: Explore
        - link "Home" [ref=e96]:
          - /url: /
        - link "Videos" [ref=e97]:
          - /url: /videos
        - link "Articles" [ref=e98]:
          - /url: /articles
        - link "About" [ref=e99]:
          - /url: /about
      - generic [ref=e100]:
        - generic [ref=e101]: Connect
        - link "hello@torahtaichi.com" [ref=e102]:
          - /url: mailto:hello@torahtaichi.com
        - generic [ref=e103]:
          - link "TikTok" [ref=e104]:
            - /url: https://tiktok.com/@torahtaichi
            - img [ref=e105]
          - link "YouTube" [ref=e107]:
            - /url: https://youtube.com/@torahtaichi
            - img [ref=e108]
          - link "Instagram" [ref=e110]:
            - /url: https://instagram.com/torahtaichi
            - img [ref=e111]
          - link "Facebook" [ref=e113]:
            - /url: https://facebook.com/torahtaichi
            - img [ref=e114]
    - generic [ref=e116]:
      - generic [ref=e117]: © 2026 Torah Tai Chi · torahtaichi.com
      - generic [ref=e118]:
        - link "About" [ref=e119]:
          - /url: /about
        - link "Contact" [ref=e120]:
          - /url: mailto:hello@torahtaichi.com
  - alert [ref=e121]
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
> 20 |     await expect(page.locator('a[href^="/videos/"]').first()).toBeVisible();
     |                                                               ^ Error: expect(locator).toBeVisible() failed
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
  68 |     expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  69 |   });
  70 | });
  71 | 
```