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
    const result = await timedFetch(
      `https://api.bufferapp.com/1/profiles.json?access_token=${token}`,
    );
    if (result.status === 401 || result.status === 403) {
      return { ok: false, latencyMs: result.latencyMs, error: 'Token expired or invalid — reconnect Buffer' };
    }
    if (!result.ok) return { ok: false, latencyMs: result.latencyMs, error: `HTTP ${result.status}` };
    return { ok: true, latencyMs: result.latencyMs };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run all health checks in parallel.
 * Safe to call from a server component — uses server-side env vars.
 */
export async function checkHealth(): Promise<SystemHealth> {
  const [supabase, storyblok, buffer, modal] = await Promise.all([
    checkSupabase(),
    checkStoryblok(),
    checkBuffer(),
    checkModal(),
  ]);

  return { supabase, storyblok, buffer, modal };
}
