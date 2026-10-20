-- Per-platform endings (2026-10-20). The stitcher now renders each final
-- video twice from the same stitched content, differing only in the
-- branded outro card:
--   videos.mp4_path            -> "Follow for a new lesson every week"
--                                 (Facebook / Instagram / TikTok / X)
--   videos.mp4_subscribe_path  -> "Subscribe for a new lesson every week"
--                                 (YouTube)
--
-- Nullable + default null: every existing row keeps mp4_path as its only
-- video, and every reader (autoPost's YouTube upload, the video page's
-- YouTube download button) falls back to mp4_path when this is null. The
-- pipeline also writes null when the subscribe cut fails, so a re-render
-- never leaves a stale subscribe file attached to a newer follow cut.

alter table videos
  add column if not exists mp4_subscribe_path text;

comment on column videos.mp4_subscribe_path is
  'Storage path (videos bucket) of the Subscribe-ending cut, posted to YouTube. Written by the Modal stitch sites next to mp4_path (the Follow-ending cut, used everywhere else). Null on rows from before 2026-10-20 or when the subscribe cut failed; readers fall back to mp4_path.';
