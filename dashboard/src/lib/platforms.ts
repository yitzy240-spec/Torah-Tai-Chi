export const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
export type Platform = typeof PLATFORMS[number];

// YouTube posts go direct via the Data API v3. The rest go through Buffer.
export const BUFFER_PLATFORMS = PLATFORMS.filter((p) => p !== 'youtube') as readonly Exclude<Platform, 'youtube'>[];
export type BufferPlatform = typeof BUFFER_PLATFORMS[number];
