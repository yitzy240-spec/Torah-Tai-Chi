-- Adds posts.error_message so failed posts (Buffer rate limit, YouTube
-- reject, async Modal worker failure) can surface a human-readable
-- cause to the operator instead of silently dropping back to the
-- un-posted CTA.
--
-- P2-B: posting card now derives isFailed = status === 'failed' and
-- renders a soft-tassel banner above the "Post to {platform}" button.
-- When error_message is non-null, the banner shows the first line
-- (truncated to 180 chars) — e.g. "Buffer: rate limited, retry in 5m"
-- or "YouTube: video size exceeds Shorts limit".
--
-- Writers: lib/post-platform.ts (server actions) + Modal/Buffer/YouTube
-- async workers should populate this column whenever they flip
-- status='failed'. Existing rows with status='failed' but no error_message
-- (legacy) simply show the generic "Last post attempt failed. Tap to
-- retry." banner — no migration needed.

alter table posts
  add column if not exists error_message text;

comment on column posts.error_message is
  'Human-readable failure cause when status=''failed''. First line shown to operator in the posting card''s failed banner. Null when status<>''failed'' or for legacy failed rows.';
