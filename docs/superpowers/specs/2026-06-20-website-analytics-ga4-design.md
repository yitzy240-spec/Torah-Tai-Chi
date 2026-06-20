# Website analytics — GA4 + dashboard link

_2026-06-20. Small feature. Approved scope: instrument the website with Google
Analytics 4 and give Yonah a one-click link to it from the dashboard. NO in-app
numbers panel (that would be the GA Data API build — deferred)._

## Goal
Yonah can see website traffic + engagement (visitors, top pages/articles,
sources, time-on-page, events, trends). He reaches it in one click from the
dashboard's existing Analytics page; the data itself lives in GA4.

## Decisions
- **Provider: Google Analytics 4** (free, standard, full traffic+engagement).
  User confirmed GA's own UI is acceptable for viewing.
- **Where Yonah views it:** GA4's UI, opened from a "Website analytics →" link
  on the dashboard `/analytics` page (next to the YouTube section).
- **Not building:** pulling GA numbers into the dashboard (GA4 Data API +
  service-account auth + charts). Revisit only if the GA hop annoys him.

## Implementation (2 small edits + 1 user step)

### 1. Instrument the website (`website/src/app/layout.tsx`)
Add the standard GA4 gtag snippet as **raw `<script>` tags in `<head>`**,
matching the existing JSON-LD pattern in this file — NO new npm dependency
(the site is on bleeding-edge Next 16 / React 19; `@next/third-parties` and
custom `useSearchParams` route trackers add dep-skew + Suspense footguns the
raw snippet avoids). Gate on an env var so dev/preview without it don't track:

```tsx
const gaId = process.env.NEXT_PUBLIC_GA_ID;
// in <head>, after the JSON-LD scripts:
{gaId && (
  <>
    <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
    <script dangerouslySetInnerHTML={{ __html:
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}`
      + `gtag('js',new Date());gtag('config','${gaId}');` }} />
  </>
)}
```
SPA pageviews (article→article client navigation) are captured by GA4
**Enhanced Measurement → "Page changes"** (History API), which is ON by default
— leave it on. No per-route code needed.

### 2. Dashboard link (`dashboard/src/app/analytics/page.tsx`)
Add a small "Website analytics →" link/button in the page header area (near the
"YouTube — {channel}" subtitle) that opens GA in a new tab. Target: env var
`NEXT_PUBLIC_GA_REPORT_URL` if set, else `https://analytics.google.com/`.
Always shown (it's just a link; no data fetch).

### 3. User step (one-time)
- Create a GA4 property for torahtaichi.com → get the `G-XXXXXXX` measurement id.
- Set `NEXT_PUBLIC_GA_ID=G-XXXXXXX` in the **website's** Vercel project env, redeploy.
- (Optional) set `NEXT_PUBLIC_GA_REPORT_URL` to a deep link to the GA report in
  the **dashboard's** Vercel project.

## Privacy note
GA4 sets cookies; strictly an EU cookie/consent notice is expected. Run as-is
for now (common for small sites); revisit if a consent banner is wanted (would
move to consent-mode or a cookieless tool).

## Testing
- Website builds clean; with `NEXT_PUBLIC_GA_ID` unset the scripts don't render
  (no tracking in dev/preview). With it set, `gtag/js?id=G-...` loads and
  GA4 Realtime shows the visit.
- Dashboard builds clean; the link appears on `/analytics` and opens GA.

## Out of scope (future phase 2, only if asked)
In-app headline number (visitors/trend) via the GA4 Data API.
