-- Per-platform direct URLs for the public-facing video page on
-- torahtaichi.com. Lets the website link to each platform's post
-- ("Watch on TikTok", "Watch on Instagram", etc.) instead of generic
-- web-share buttons that just share the website URL.
--
-- We denormalize onto videos rather than expose `posts` to anon RLS:
--   - posts has internal fields (caption, status) we don't want public,
--   - videos is already anon-readable (filtered to published), so the
--     website can read post_urls in the same query that fetches the video.
--
-- The dashboard maintains this column from auto-post results:
--   - YouTube: written immediately on successful upload (the URL is
--     deterministic given the video id).
--   - Buffer-backed (TikTok/Instagram/Facebook/X): written in two steps —
--     a row in `posts` with buffer_update_id at insert time, then the
--     Buffer GraphQL externalLink is resolved (post-publish) and merged
--     into videos.post_urls. Resolution is best-effort; nulls just hide
--     that platform's button on the website.
alter table videos
  add column if not exists post_urls jsonb not null default '{}'::jsonb;

comment on column videos.post_urls is
  'Per-platform direct URLs for the public-facing video page. Keys are platform names (tiktok, instagram, youtube, facebook, twitter); values are full URLs to the post on that network. Missing keys = not posted there yet (or URL not yet resolvable).';

-- The posts.platform check still rejects 'twitter' even though we
-- generate captions for it. Loosen so X posts can land in the table
-- and their externalLink resolution can write back to videos.post_urls.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'posts_platform_check') then
    alter table posts drop constraint posts_platform_check;
  end if;
end$$;

alter table posts
  add constraint posts_platform_check
  check (platform in ('tiktok', 'instagram', 'youtube', 'facebook', 'twitter'));
