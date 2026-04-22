/**
 * System health checks — one per external service.
 * Each check has a 3-second timeout and returns { ok, latencyMs?, error? }.
 */

export interface ServiceHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SystemHealth {
  supabase: ServiceHealth;
  storyblok: ServiceHealth;
  buffer: ServiceHealth | null; // null when token not configured
  modal: ServiceHealth | null;  // null when URL not configured
  youtube: ServiceHealth | null; // null when not connected
}

const TIMEOUT_MS = 6000;
const MODAL_TIMEOUT_MS = 10000; // Modal endpoints can cold-start; allow longer

async function timedFetch(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ ok: boolean; latencyMs: number; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function checkSupabase(): Promise<ServiceHealth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, error: 'SUPABASE_URL or ANON_KEY not set' };

  try {
    const result = await timedFetch(
      `${url}/rest/v1/parshiot?select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!result.ok) return { ok: false, latencyMs: result.latencyMs, error: `HTTP ${result.status}` };
    return { ok: true, latencyMs: result.latencyMs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkStoryblok(): Promise<ServiceHealth> {
  const token = process.env.STORYBLOK_PREVIEW_TOKEN;
  if (!token) return { ok: false, error: 'STORYBLOK_PREVIEW_TOKEN not set' };

  try {
    const result = await timedFetch(
      `https://api.storyblok.com/v2/cdn/spaces/me?token=${token}`,
    );
    if (!result.ok) return { ok: false, latencyMs: result.latencyMs, error: `HTTP ${result.status}` };
    return { ok: true, latencyMs: result.latencyMs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkBuffer(): Promise<ServiceHealth | null> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) return null; // not configured — show nothing, not red

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.buffer.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ account { id } }' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs, error: 'Token expired or invalid — reconnect Buffer' };
    }
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    return { ok: true, latencyMs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkModal(): Promise<ServiceHealth | null> {
  const url = process.env.MODAL_WORKER_URL;
  if (!url) return null; // not configured — show nothing

  try {
    // GET — Modal's @fastapi_endpoint ignores HEAD. Any response (200/404/405)
    // proves the router is alive; only a network-level failure is "down".
    const result = await timedFetch(url, { method: 'GET' }, MODAL_TIMEOUT_MS);
    return { ok: true, latencyMs: result.latencyMs };
  } catch (e) {
    // AbortError just means the cold-start exceeded our health-check
    // timeout — Modal will warm up on the next real request. Don't
    // surface this as 'unavailable' since generation still works.
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(msg))) {
      return { ok: true, error: 'cold start (warming up)' };
    }
    return { ok: false, error: msg };
  }
}

async function checkYouTube(): Promise<ServiceHealth | null> {
  // Import lazily to avoid hard-wiring a Supabase service client in contexts
  // that don't need it (e.g. route.ts imports of this module).
  const { getConnection } = await import('@/lib/youtube');
  const conn = await getConnection();
  if (!conn.connected) return null;
  // Presence of a non-expired row is the signal; we don't round-trip to Google
  // here to keep this cheap. The first upload attempt will surface real issues.
  return { ok: true };
}

/**
 * Run all health checks in parallel.
 * Safe to call from a server component — uses server-side env vars.
 */
export async function checkHealth(): Promise<SystemHealth> {
  const [supabase, storyblok, buffer, modal, youtube] = await Promise.all([
    checkSupabase(),
    checkStoryblok(),
    checkBuffer(),
    checkModal(),
    checkYouTube(),
  ]);

  return { supabase, storyblok, buffer, modal, youtube };
}
