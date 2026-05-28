// dashboard/src/lib/humanize-render-error.ts
//
// Translate a raw error_message from a failed render/regen into a
// short, action-oriented sentence Yonah can act on. Pattern-matches
// the actual strings Modal writes to jobs.error_message — when we hit
// a new failure mode in the wild, add a pattern here so the next
// operator sees an explanation instead of a Python traceback.
//
// Used by:
//   - phase-2-plan-review.tsx persistent failed banner (per-card)
//   - editable-clip-card.tsx regen result toast
//   - any other surface that displays jobs.error_message / clips.error_message
//
// Returns one string. Callers truncate / style as they see fit.
// Original error text is preserved verbatim in the View log link so
// engineers can still debug from a screenshot.

export function humanizeRenderError(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) {
    return 'Render failed. Open the View log link for details.';
  }
  const lower = raw.toLowerCase();

  // ─── Kie / Seedance upstream issues ─────────────────────────────────
  // Yonah hit kieai.redpandaai.co 500 on file-base64-upload 2026-05-28.
  // Modal now retries 5xx 3x, but a sustained Kie outage still surfaces.
  const isKieHost = lower.includes('kieai.redpandaai.co') || lower.includes('kie.ai');
  const is5xx =
    lower.includes('500 internal server') ||
    lower.includes('502 bad gateway') ||
    lower.includes('503 service unavailable') ||
    lower.includes('504 gateway timeout') ||
    /\bserver error '50[0-9]/.test(lower);

  if (isKieHost && is5xx) {
    return "Kie (the video service) is having a server issue right now. Try again in a couple minutes — if it keeps failing, Kie is down.";
  }
  if (is5xx) {
    return 'An upstream service is having a temporary problem. Try again in a few minutes.';
  }

  // ─── Kie credits / quota (existing patterns from editable-clip-card) ─
  if (
    lower.includes('credit') &&
    (lower.includes('exhaust') || lower.includes('insufficient') || lower.includes('not enough'))
  ) {
    return 'Out of Kie credits. Top up at kie.ai/billing, then try again.';
  }
  if (lower.includes('quota')) {
    return 'Kie quota hit. Wait a few minutes or top up at kie.ai/billing, then try again.';
  }

  // ─── Auth / config ─────────────────────────────────────────────────
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('api key') ||
    lower.includes('api_key')
  ) {
    return 'Authentication issue with an upstream service. Check API keys in Settings, then try again.';
  }

  // ─── Timeouts ──────────────────────────────────────────────────────
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The render took too long and gave up. Try again, or split the script into shorter clips if it keeps happening.';
  }

  // ─── Network ───────────────────────────────────────────────────────
  if (
    lower.includes('connection') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('dns')
  ) {
    return 'Network problem reaching an upstream service. Try again in a moment.';
  }

  // ─── Modal pipeline failures ────────────────────────────────────────
  if (lower.includes('modal') && lower.includes('exception')) {
    return 'The pipeline hit an internal error. Try again; if it persists, open the log link.';
  }

  // ─── Fallback: show the first line truncated, with a hint to view log
  const firstLine = raw.split('\n')[0]?.trim() ?? raw;
  return `Render failed: ${firstLine.slice(0, 180)}${firstLine.length > 180 ? '…' : ''}`;
}
