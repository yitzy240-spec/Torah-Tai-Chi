-- Per-clip Gemini visual verification.
--
-- After Seedance generates each new clip, the pipeline now sends the
-- mp4 to Gemini (via OpenRouter) along with a list of clip-specific
-- claims derived from the user's feedback. Gemini returns pass/fail
-- per claim with timestamped evidence. If any check fails, the clip
-- is regenerated once (hard cap: 2 attempts). The columns below are
-- written by the pipeline to surface that loop in the dashboard.
--
-- verification_status:
--   'unchecked' — no verification run (pre-feature rows or skip).
--   'verifying' — Gemini call in progress for this clip.
--   'verified'  — Gemini's most-recent attempt passed every check.
--   'failed'    — Gemini's most-recent attempt failed at least one
--                 check AND we are out of retries (or Gemini errored
--                 and we shipped the clip anyway). User should review.
--
-- verification_attempts: 0..2. Bounded by the pipeline's retry cap.
--
-- verification_notes: full Gemini structured response for the latest
-- attempt, exactly as parsed in modal_app._gemini_verify_clip. Kept
-- raw so the dashboard can render evidence (timestamp + observation)
-- per failed check without another round-trip.
--
-- All operations are idempotent — safe to re-run if applied partially.
alter table clips add column if not exists verification_status text
  default 'unchecked'
  check (verification_status in ('unchecked', 'verifying', 'verified', 'failed'));

alter table clips add column if not exists verification_attempts int
  default 0;

alter table clips add column if not exists verification_notes jsonb;
