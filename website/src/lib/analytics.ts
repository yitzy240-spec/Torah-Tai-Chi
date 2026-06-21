// website/src/lib/analytics.ts
//
// Thin client-side GA4 event helper. The gtag script is injected by the root
// layout ONLY when NEXT_PUBLIC_GA_ID is set (dev/preview have no GA), so
// track() is a safe no-op whenever window.gtag is absent — calling it can
// never break a page.

type GtagParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: GtagParams) => void;
  }
}

/** Fire a GA4 custom event. No-op when GA isn't loaded. */
export function track(event: string, params?: GtagParams): void {
  if (typeof window === 'undefined') return;
  window.gtag?.('event', event, params);
}
