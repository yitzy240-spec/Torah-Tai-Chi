export const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter'] as const;
export type Platform = typeof PLATFORMS[number];

/**
 * Platforms we currently post to. TikTok was disconnected on 2026-05-28
 * in favor of Facebook (no traction on TikTok); historical posts on
 * TikTok still exist in the DB and live on TikTok, but the dashboard UI
 * stops offering it for new work. Forward-facing components (posting
 * cards, caption editor, live-at-rest status) iterate ACTIVE_PLATFORMS;
 * the posts table and Modal pipeline keep using the full PLATFORMS
 * union so the schema can still represent historical TikTok rows.
 */
export const ACTIVE_PLATFORMS = ['instagram', 'youtube', 'facebook', 'twitter'] as const satisfies readonly Platform[];
export type ActivePlatform = typeof ACTIVE_PLATFORMS[number];

// YouTube posts go direct via the Data API v3. The rest go through Buffer
// (including Twitter/X — Buffer handles text + image + video for it).
export const BUFFER_PLATFORMS = PLATFORMS.filter((p) => p !== 'youtube') as readonly Exclude<Platform, 'youtube'>[];
export type BufferPlatform = typeof BUFFER_PLATFORMS[number];

/** Per-platform caption length caps (characters). Twitter/X is the tight one. */
export const CAPTION_LIMITS: Record<Platform, number> = {
  tiktok: 2200,
  instagram: 2200,
  youtube: 5000,
  facebook: 63206,
  twitter: 280,
};

/** Human-readable platform labels for UI. */
export const PLATFORM_DISPLAY: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitter: 'X',
};

/**
 * Caption fields are the actual editable units in the captions UI. Most
 * platforms have one (the post text); YouTube has two (title + the long
 * description) and we let the user edit each one independently rather
 * than hiding them behind a flattened "first line is title" hack.
 */
export const CAPTION_FIELDS = [
  'tiktok',
  'instagram',
  'youtube_title',
  'youtube_description',
  'facebook',
  'twitter',
] as const;
export type CaptionField = typeof CAPTION_FIELDS[number];

/** Per-field char limits. YouTube title API cap is 100; description is 5000. */
export const CAPTION_FIELD_LIMITS: Record<CaptionField, number> = {
  tiktok: 2200,
  instagram: 2200,
  youtube_title: 100,
  youtube_description: 5000,
  facebook: 63206,
  twitter: 280,
};

/** Human-readable label per field. */
export const CAPTION_FIELD_DISPLAY: Record<CaptionField, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube_title: 'YouTube title',
  youtube_description: 'YouTube description',
  facebook: 'Facebook',
  twitter: 'X',
};

/** Maps a caption field back to its underlying delivery platform. Used
 *  to filter the captions list by what's actually connected. */
export const CAPTION_FIELD_PLATFORM: Record<CaptionField, Platform> = {
  tiktok: 'tiktok',
  instagram: 'instagram',
  youtube_title: 'youtube',
  youtube_description: 'youtube',
  facebook: 'facebook',
  twitter: 'twitter',
};
