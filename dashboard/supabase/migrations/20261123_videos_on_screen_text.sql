-- On-screen hook + spoken captions burned in at stitch time (not during
-- Seedance generation). Nullable hook/override so existing videos stay
-- unchanged; the toggle defaults OFF so a transitions re-stitch cannot
-- suddenly burn text onto a published reel.
--
-- DO NOT apply this to production from CI. Yitzy must approve the DB
-- change and apply it manually before this PR is merged (Modal compose
-- reads these columns; dashboard saves also write stitch_settings.on_screen
-- as a fallback).

alter table videos
  add column if not exists hook_text text,
  add column if not exists caption_override text,
  add column if not exists burn_on_screen_text boolean not null default false;

comment on column videos.hook_text is
  'Optional short hook line burned over the first ~3 seconds of the stitched video, in the reel safe zone. Null/empty means no hook.';

comment on column videos.caption_override is
  'Optional replacement for on-screen spoken captions. When null/empty, captions default to each clip''s voiceover, word for word. Use this when the voiceover contains pronunciation spellings that should not appear on screen.';

comment on column videos.burn_on_screen_text is
  'When true, compose/re-stitch burns hook_text (if set) and spoken captions (caption_override, or clip voiceovers) onto both the Follow and Subscribe endings, never over the end card. Defaults false so existing videos are unchanged.';
