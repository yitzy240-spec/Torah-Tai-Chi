export const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter'] as const;
export type Platform = typeof PLATFORMS[number];

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
