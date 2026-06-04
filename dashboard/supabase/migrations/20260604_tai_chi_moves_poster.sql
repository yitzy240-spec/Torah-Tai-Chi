-- Phase 4.1 — add a poster column to tai_chi_moves.
--
-- Why: MotionPickerSheet renders 39+ <video autoPlay> elements at
-- 40×71 px each. Browser downloads ~50 MB of MP4 + spins up decoders on
-- every picker open — unusable over cellular per the perf audit.
-- A tiny WebP poster (~1-2 KB each) replaces the autoplay video and
-- gives the operator a still preview; the full video promotes-to-play
-- only when they tap a specific item.
--
-- Nullable so a moves row without a generated poster still renders
-- (falls back to the existing solid background). Population is done by
-- tools/generate_move_posters.py which writes the relative storage
-- path (tai_chi_moves/<slug>.webp) here after upload.

alter table tai_chi_moves
  add column if not exists thumb_poster_path text;

comment on column tai_chi_moves.thumb_poster_path is
  'Storage path (videos bucket) of an 80×142 WebP poster frame extracted from mp4_storage_path. Populated by tools/generate_move_posters.py. Null = no poster generated yet; UI falls back to a solid background.';
