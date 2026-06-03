-- Adds videos.youtube_thumbnail_url so the operator's hand-picked YouTube
-- cover frame survives a page reload. Before this column, saveYouTubeThumbnail
-- uploaded the JPEG to storage but only kept the URL in the YouTube card's
-- local React state — reload the page and the auto-extracted thumb at
-- videos.thumb_path shipped instead, silently dropping the operator's pick.
--
-- Also feeds the "Post all" path: postAllPlatforms now reads this column
-- (via the Phase 5 data fetch) and forwards it as autoPost.youtubeThumbnailUrl
-- so the YouTube channel inside a fanout uses the operator's frame too.
--
-- Stores a fully-qualified public storage URL (videos bucket, thumbnails/
-- prefix) — same shape autoPost has accepted for the youtubeThumbnailUrl arg
-- since the bug-fix passthrough landed.
--
-- Nullable + default null: existing rows have no picked thumb and autoPost
-- already falls back to the auto-extracted videos.thumb_path when this is
-- missing, so backfill is unnecessary.

alter table videos
  add column if not exists youtube_thumbnail_url text;

comment on column videos.youtube_thumbnail_url is
  'Operator-picked YouTube cover frame URL (public storage URL in the videos bucket, thumbnails/ prefix). Set by saveYouTubeThumbnail. Read by autoPost as the YouTube thumbnail override; falls back to videos.thumb_path when null.';
