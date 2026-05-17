-- Snapshot title fields onto videos at stitch time. Kills the anon-RLS
-- chain-walk problem (kickoff doc bug 7) and is the source of truth for
-- the website's parsha page. Phase 5 Site card writes these directly.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Per-platform structured data added during the Phase 5 redesign.
-- captions stays as today (flat string per platform) and continues to
-- be canonical for Buffer's text field; social_metadata holds the new
-- per-platform extras (Reel/Post type, firstComment) and youtube_tags
-- replaces the hardcoded ['Torah','Tai Chi','Shorts'] in auto-post.ts.

ALTER TABLE clip_plans
  ADD COLUMN IF NOT EXISTS social_metadata JSONB,
  ADD COLUMN IF NOT EXISTS youtube_tags TEXT[];

COMMENT ON COLUMN videos.title IS
  'Title shown on torahtaichi.com. Snapshotted from scripts.title at stitch time so the website does not have to walk videos.job_id -> jobs.script_id (anon RLS blocks that).';

COMMENT ON COLUMN videos.subtitle IS
  'Subtitle shown on torahtaichi.com. Snapshotted from scripts.title at stitch time.';

COMMENT ON COLUMN videos.description IS
  'Description shown on torahtaichi.com. Snapshotted from scripts.tldr at stitch time.';

COMMENT ON COLUMN clip_plans.social_metadata IS
  'Per-platform metadata. Shape: {instagram?: {type: "reel"|"post", firstComment?: string}, facebook?: {type, firstComment?}}.';

COMMENT ON COLUMN clip_plans.youtube_tags IS
  'YouTube tags array. Replaces hardcoded [Torah, Tai Chi, Shorts] in lib/auto-post.ts. Empty array = no tags.';

COMMENT ON COLUMN clips.motion_ref_slug IS
  'Per-clip Tai Chi move (references tai_chi_moves.slug). NULL = no move on this clip. Set by the operator via the Phase 2/3 picker; falls back to scripts.motion_ref_slug in clips-only for legacy plans.';
