-- Per spec B4: per-clip reference image control + break-chain flag.
--
-- clips.reference_image_paths  — operator-selected list of Storage paths for
--   reference images. When non-NULL the Modal pipeline uses this list directly
--   instead of auto-selecting from char/dojo/jewish-ref logic. NULL = auto.
--
-- clips.chain_broken  — when TRUE, the Modal pipeline skips first-frame
--   chaining for this clip even if the setting_id matches the previous clip.
--   Set via the dashboard's "Break chain" action in Phase 2.

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS reference_image_paths TEXT[],
  ADD COLUMN IF NOT EXISTS chain_broken BOOLEAN DEFAULT false;

COMMENT ON COLUMN clips.reference_image_paths IS
  'Operator-selected reference image Storage paths for this clip. '
  'When non-NULL, Modal uses these instead of auto-selecting char/dojo/jewish '
  'refs. Max 9 images (Seedance constraint). Set via Phase 2 reference picker.';

COMMENT ON COLUMN clips.chain_broken IS
  'When TRUE, Modal skips first-frame chaining for this clip even if '
  'setting_id matches the previous clip. Set by the dashboard Break chain '
  'action in Phase 2 plan review.';
