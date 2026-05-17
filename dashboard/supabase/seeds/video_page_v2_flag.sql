-- Seed: enable the video_page_v2 feature flag.
--
-- DO NOT run this via `supabase db push` — seeds are not applied
-- automatically. Apply manually via Supabase Studio SQL editor or
-- `supabase db query`.
--
-- Setting value='true' routes ALL /videos/[slug] requests to the new
-- VideoDetailPageNew component. To roll back without a deploy, set
-- value='false' or delete the row.
--
-- The dispatcher also accepts a ?v2=1 / ?v2=0 query override for
-- side-by-side testing without touching this flag globally.

INSERT INTO site_content (key, value)
VALUES ('settings.video_page_v2', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
