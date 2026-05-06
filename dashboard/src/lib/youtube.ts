/**
 * YouTube Data API v3 client.
 *
 * Auth model: a one-time OAuth consent stores a refresh token in the
 * `oauth_tokens` table (service='youtube'). Every upload call exchanges
 * that refresh token for a fresh 1h access token via Google's token
 * endpoint.
 *
 * Scopes required: youtube.upload (for videos.insert + thumbnails.set) and
 * youtube.readonly (so we can show channel handle/title on the Channels page).
 */

import { createServiceClient } from '@/lib/supabase/service';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAILS_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
const PLAYLIST_ITEMS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';
const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Required for the YouTube Analytics API v2 (watch time, geography,
  // demographics). Existing tokens issued before this scope was added
  // will 403 from /youtubeAnalytics/v2/reports — the UI surfaces a
  // reconnect banner via YouTubeScopeError below.
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export interface YouTubeConnection {
  connected: true;
  channelId: string;
  channelTitle: string;
  connectedAt: string;
}

export interface NoYouTubeConnection {
  connected: false;
}

/**
 * Current YouTube connection status, read from the oauth_tokens table.
 * Safe to call from server components — uses the service-role client so
 * it bypasses RLS without leaking the token itself to the UI layer.
 */
export async function getConnection(): Promise<YouTubeConnection | NoYouTubeConnection> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('oauth_tokens')
    .select('account_id, account_name, connected_at')
    .eq('service', 'youtube')
    .maybeSingle();

  if (error || !data) return { connected: false };
  return {
    connected: true,
    channelId: data.account_id ?? '',
    channelTitle: data.account_name ?? '',
    connectedAt: data.connected_at,
  };
}

/**
 * Exchange the stored refresh token for a fresh access token. Caches the
 * access token in oauth_tokens.access_token until ~1m before expiry so we
 * don't hit Google on every call within a request.
 */
export async function getAccessToken(): Promise<string> {
  const sb = createServiceClient();
  const { data: row, error } = await sb
    .from('oauth_tokens')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('service', 'youtube')
    .single();
  if (error || !row) throw new Error('YouTube not connected');

  const now = Date.now();
  const exp = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && exp > now + 60_000) return row.access_token;

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID/SECRET not set');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`YouTube token refresh: ${res.status} ${t}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();

  await sb.from('oauth_tokens').update({
    access_token: body.access_token,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('service', 'youtube');

  return body.access_token;
}

export interface ExchangeCodeResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: string;
  channelId: string;
  channelTitle: string;
}

/**
 * Exchange an OAuth authorization code (from the callback) for tokens,
 * then fetch the signed-in channel's id/title. Does NOT persist anything —
 * the callback route does that after this resolves.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID/SECRET not set');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`YouTube code exchange: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!body.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. This usually means the user already granted access — revoke at https://myaccount.google.com/permissions and try again.',
    );
  }

  const chRes = await fetch(`${CHANNELS_ENDPOINT}?mine=true&part=snippet`, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!chRes.ok) throw new Error(`YouTube channels.list: ${chRes.status} ${await chRes.text()}`);
  const chBody = (await chRes.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
  const first = chBody.items?.[0];
  if (!first) throw new Error('YouTube account has no channel');

  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    channelId: first.id,
    channelTitle: first.snippet.title,
  };
}

/**
 * Revoke the stored refresh token at Google and delete the row. Idempotent.
 */
export async function disconnect(): Promise<void> {
  const sb = createServiceClient();
  const { data } = await sb
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('service', 'youtube')
    .maybeSingle();

  if (data?.refresh_token) {
    // Best-effort revoke; ignore failures — we're deleting the row regardless.
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: data.refresh_token }),
    }).catch(() => {});
  }
  await sb.from('oauth_tokens').delete().eq('service', 'youtube');
}

export interface UploadVideoArgs {
  /** Publicly reachable MP4 URL (we fetch and stream the bytes into YouTube). */
  videoUrl: string;
  title: string;
  description: string;
  tags?: string[];
  /** Public immediately, or private-with-scheduled-publish. */
  publishAt?: Date;
  /** Optional public URL for a custom thumbnail (requires a verified channel). */
  thumbnailUrl?: string;
  /** YouTube category id; default 22 = People & Blogs. See ytcategory docs. */
  categoryId?: string;
}

export interface UploadVideoResult {
  id: string;
  status: string;
}

/**
 * Upload a video to the connected YouTube channel. If `publishAt` is set,
 * the video is uploaded as private + scheduled; otherwise it goes public
 * immediately. Uses multipart upload (fine for our ~45s Shorts at 480p/1080p;
 * under the 100MB single-request cap comfortably).
 */
export async function uploadVideo(args: UploadVideoArgs): Promise<UploadVideoResult> {
  const accessToken = await getAccessToken();

  const scheduled = !!args.publishAt;
  const snippet = {
    title: args.title,
    description: args.description,
    tags: args.tags ?? [],
    categoryId: args.categoryId ?? '22',
  };
  const status = scheduled
    ? { privacyStatus: 'private', publishAt: args.publishAt!.toISOString(), selfDeclaredMadeForKids: false }
    : { privacyStatus: 'public', selfDeclaredMadeForKids: false };

  const mp4Res = await fetch(args.videoUrl);
  if (!mp4Res.ok) throw new Error(`Fetch video bytes: ${mp4Res.status}`);
  const videoBytes = new Uint8Array(await mp4Res.arrayBuffer());

  const boundary = `tt-boundary-${Date.now()}`;
  const metaPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ snippet, status }) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: video/mp4\r\n\r\n';
  const tail = `\r\n--${boundary}--`;

  const enc = new TextEncoder();
  const head = enc.encode(metaPart);
  const foot = enc.encode(tail);
  const body = new Uint8Array(head.length + videoBytes.length + foot.length);
  body.set(head, 0);
  body.set(videoBytes, head.length);
  body.set(foot, head.length + videoBytes.length);

  const upRes = await fetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!upRes.ok) throw new Error(`YouTube videos.insert: ${upRes.status} ${await upRes.text()}`);
  const upBody = (await upRes.json()) as { id: string; status: { uploadStatus: string; privacyStatus: string } };

  if (args.thumbnailUrl) {
    try {
      const thumbRes = await fetch(args.thumbnailUrl);
      if (thumbRes.ok) {
        const thumbBytes = await thumbRes.arrayBuffer();
        const ct = thumbRes.headers.get('content-type') ?? 'image/png';
        await fetch(`${THUMBNAILS_ENDPOINT}?videoId=${encodeURIComponent(upBody.id)}&uploadType=media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': ct },
          body: thumbBytes,
        });
      }
    } catch {
      // Non-fatal — the video is still uploaded.
    }
  }

  return { id: upBody.id, status: upBody.status.uploadStatus };
}

// ─────────────────────────────────────────────────────────────────────────
// Reads for the performance page
// ─────────────────────────────────────────────────────────────────────────

export interface ChannelVideoStats {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  views: number;
  likes: number;
  comments: number;
  durationIso: string;
  privacyStatus: 'public' | 'unlisted' | 'private' | string;
}

/**
 * Fetch the connected channel's most recent uploads with view/like/comment
 * counts. Walks three YouTube Data API endpoints:
 *   1. channels.list → get the uploads playlist id
 *   2. playlistItems.list → page through recent uploads (ids + thumbs)
 *   3. videos.list → hydrate stats in a single batch (up to 50 ids)
 *
 * Quota cost: ~3 units per call regardless of how many videos (videos.list
 * is 1 unit per call even with 50 ids). Well under the 10k/day free tier.
 */
export async function listChannelVideos(limit = 25): Promise<ChannelVideoStats[]> {
  const accessToken = await getAccessToken();

  // 1. uploads playlist
  const chRes = await fetch(`${CHANNELS_ENDPOINT}?mine=true&part=contentDetails`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!chRes.ok) throw new Error(`YouTube channels.list: ${chRes.status}`);
  const chBody = (await chRes.json()) as {
    items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }>;
  };
  const uploadsPlaylist = chBody.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) return [];

  // 2. playlist items (capped at 50 per call; pagination if needed later)
  const plRes = await fetch(
    `${PLAYLIST_ITEMS_ENDPOINT}?playlistId=${uploadsPlaylist}&part=snippet,contentDetails&maxResults=${Math.min(limit, 50)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!plRes.ok) throw new Error(`YouTube playlistItems.list: ${plRes.status}`);
  const plBody = (await plRes.json()) as {
    items?: Array<{
      contentDetails: { videoId: string };
      snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    }>;
  };
  const items = plBody.items ?? [];
  if (items.length === 0) return [];

  const ids = items.map((i) => i.contentDetails.videoId);
  const itemById = new Map(items.map((i) => [i.contentDetails.videoId, i]));

  // 3. hydrate stats
  const vRes = await fetch(
    `${VIDEOS_ENDPOINT}?id=${ids.join(',')}&part=snippet,statistics,contentDetails,status`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!vRes.ok) throw new Error(`YouTube videos.list: ${vRes.status}`);
  const vBody = (await vRes.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      contentDetails?: { duration?: string };
      status?: { privacyStatus?: string };
    }>;
  };

  return (vBody.items ?? []).map((v) => {
    const thumbs = v.snippet.thumbnails ?? itemById.get(v.id)?.snippet.thumbnails ?? {};
    const thumb = thumbs.medium?.url ?? thumbs.default?.url ?? '';
    return {
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      thumbnailUrl: thumb,
      views: Number(v.statistics?.viewCount ?? 0),
      likes: Number(v.statistics?.likeCount ?? 0),
      comments: Number(v.statistics?.commentCount ?? 0),
      durationIso: v.contentDetails?.duration ?? '',
      privacyStatus: v.status?.privacyStatus ?? 'public',
    };
  });
}

export interface YouTubeComment {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorChannelUrl: string | null;
  text: string;        // Plain text. The API also returns HTML; we use the plain version.
  publishedAt: string; // ISO timestamp
  likeCount: number;
  replyCount: number;
}

/**
 * List the most recent top-level comments for a YouTube video. Uses an
 * OAuth access token (we already have one wired up for upload + readonly)
 * but the underlying scope `youtube.readonly` is sufficient — no new
 * scope needed for read-only comment access on public videos.
 *
 * Returns an empty array on permission errors (private videos, comments
 * disabled, etc.) so the UI can render "no comments yet" gracefully.
 *
 * @param videoId  YouTube video id (the 11-char public id)
 * @param max      Maximum top-level threads to return (default 25)
 */
export async function listVideoComments(
  videoId: string,
  max: number = 25,
): Promise<YouTubeComment[]> {
  const accessToken = await getAccessToken();
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', String(Math.min(Math.max(max, 1), 100)));
  url.searchParams.set('order', 'time'); // newest first

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Common: 403 commentsDisabled, 404 videoNotFound. Don't throw —
    // return [] so the UI can show empty-state messaging.
    return [];
  }
  const data = await res.json() as {
    items?: Array<{
      id: string;
      snippet?: {
        topLevelComment?: {
          snippet?: {
            authorDisplayName?: string;
            authorProfileImageUrl?: string;
            authorChannelUrl?: string;
            textDisplay?: string;
            textOriginal?: string;
            publishedAt?: string;
            likeCount?: number;
          };
        };
        totalReplyCount?: number;
      };
    }>;
  };
  return (data.items ?? []).map((item) => {
    const top = item.snippet?.topLevelComment?.snippet;
    return {
      id: item.id,
      authorName: top?.authorDisplayName ?? '(unknown)',
      authorAvatarUrl: top?.authorProfileImageUrl ?? null,
      authorChannelUrl: top?.authorChannelUrl ?? null,
      // Prefer the plain-text rendering (textOriginal) if present, fall
      // back to textDisplay (which is HTML — we don't render it as HTML
      // anyway, so worst case it shows literal <br> etc).
      text: top?.textOriginal ?? top?.textDisplay ?? '',
      publishedAt: top?.publishedAt ?? new Date().toISOString(),
      likeCount: top?.likeCount ?? 0,
      replyCount: item.snippet?.totalReplyCount ?? 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// YouTube Analytics API v2 — watch time, geography, demographics
//
// Requires the yt-analytics.readonly scope. Tokens issued before that
// scope was added to YOUTUBE_SCOPES will 403; callers should catch
// YouTubeScopeError and surface a reconnect banner.
// ─────────────────────────────────────────────────────────────────────────

const ANALYTICS_REPORTS_ENDPOINT = 'https://youtubeanalytics.googleapis.com/v2/reports';

/** Default analytics window. YouTube Analytics defaults to 28 days for
 *  most channel-level reports — keep that consistent across our cards. */
const DEFAULT_WINDOW_DAYS = 28;

export interface ChannelWatchSummary {
  /** Total minutes watched in window. */
  watchTimeMinutes: number;
  /** Avg view duration in seconds. */
  averageViewDurationSeconds: number;
  /** Total views in window (for cross-checking against Data API). */
  views: number;
}

export interface CountryViewShare {
  countryCode: string; // 2-letter ISO
  views: number;
  watchTimeMinutes: number;
}

export interface AgeGenderShare {
  ageGroup: string; // e.g. "age25-34"
  gender: 'male' | 'female' | 'user_specified' | 'unknown';
  viewerPercentage: number;
}

/**
 * Thrown when the Analytics API returns 403 — typically means the OAuth
 * refresh token doesn't carry yt-analytics.readonly. The UI should
 * surface a "Reconnect YouTube" banner that points the user back at
 * /api/auth/youtube/start (which already sends prompt=consent so Google
 * re-prompts and issues a token with the widened scope set).
 */
export class YouTubeScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeScopeError';
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Low-level wrapper around https://youtubeanalytics.googleapis.com/v2/reports.
 * Translates 403s into YouTubeScopeError so the page can render a
 * reconnect banner instead of a generic error.
 */
async function analyticsQuery(params: Record<string, string>): Promise<unknown> {
  const accessToken = await getAccessToken();
  const url = new URL(ANALYTICS_REPORTS_ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    // Parse YouTube's structured error so we can distinguish scope issues
    // from API-not-enabled, quota-exhausted, channel-ineligible, etc.
    // YouTube returns: { error: { code, message, errors: [{ reason }] } }
    let reason: string | null = null;
    let parsedMessage: string | null = null;
    try {
      const parsed = JSON.parse(body) as {
        error?: { errors?: Array<{ reason?: string }>; message?: string };
      };
      reason = parsed.error?.errors?.[0]?.reason ?? null;
      parsedMessage = parsed.error?.message ?? null;
    } catch {
      // body wasn't JSON — leave reason null
    }
    console.error(
      `[youtube-analytics] ${res.status} reason=${reason ?? 'unknown'} ` +
      `message=${parsedMessage ?? body.slice(0, 200)}`,
    );

    if (res.status === 403) {
      // Only flip the reconnect banner when the 403 is actually a scope/
      // permission problem. accessNotConfigured / quotaExceeded / etc.
      // need different guidance, not a re-OAuth.
      const SCOPE_REASONS = new Set([
        'insufficientPermissions',
        'forbidden',
        'authError',
      ]);
      if (reason && SCOPE_REASONS.has(reason)) {
        throw new YouTubeScopeError(
          `YouTube Analytics 403 ${reason}: ${parsedMessage ?? body.slice(0, 200)}`,
        );
      }
      throw new Error(
        `YouTube Analytics 403 (non-scope) reason=${reason ?? 'unknown'}: ${parsedMessage ?? body.slice(0, 200)}`,
      );
    }
    throw new Error(
      `YouTube Analytics ${res.status} reason=${reason ?? 'unknown'}: ${parsedMessage ?? body.slice(0, 200)}`,
    );
  }
  return res.json();
}

/**
 * Channel-level watch summary for the last N days (default 28).
 * Returns zeros if the API responds with no rows (new channels, or a
 * brand-new window with no traffic).
 */
export async function getChannelWatchSummary(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ChannelWatchSummary> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'estimatedMinutesWatched,averageViewDuration,views',
  })) as { rows?: number[][] };
  const row = data.rows?.[0] ?? [0, 0, 0];
  return {
    watchTimeMinutes: row[0] ?? 0,
    averageViewDurationSeconds: row[1] ?? 0,
    views: row[2] ?? 0,
  };
}

/**
 * Top countries by view count for the last N days (default 28).
 * Capped to 50 by the API; we default to 10 for the UI list.
 */
export async function getTopCountries(
  max: number = 10,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<CountryViewShare[]> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'country',
    sort: '-views',
    maxResults: String(Math.min(Math.max(max, 1), 50)),
  })) as { rows?: Array<[string, number, number]> };
  return (data.rows ?? []).map(([countryCode, views, watchTimeMinutes]) => ({
    countryCode,
    views,
    watchTimeMinutes,
  }));
}

/**
 * Age × gender viewer percentage for the last N days (default 28).
 * Returns an empty array when YouTube has insufficient data for the
 * cohort (typically <100 views per cohort) — UI shows an "insufficient
 * data" placeholder rather than throwing.
 */
export async function getAgeGenderShare(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<AgeGenderShare[]> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'viewerPercentage',
    dimensions: 'ageGroup,gender',
  })) as { rows?: Array<[string, string, number]> };
  return (data.rows ?? []).map(([ageGroup, gender, viewerPercentage]) => ({
    ageGroup,
    gender: (gender as AgeGenderShare['gender']) ?? 'unknown',
    viewerPercentage,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Per-video Analytics — same dimensions as the channel-level cards but
// scoped to a single videoId. Used by the expandable "drill-down" panel
// on each row of the /analytics video list.
//
// All four queries hit the same /reports endpoint as the channel-level
// versions; the only difference is `filters: video==<videoId>`. Quota
// cost is identical to the channel-level queries (1 unit each).
// ─────────────────────────────────────────────────────────────────────────

export interface RetentionPoint {
  /** 0..1, where 0 = video start and 1 = video end. */
  elapsedRatio: number;
  /** 0..1 — fraction of the audience still watching at this point. */
  audienceWatchRatio: number;
  /**
   * 0..1 — relative retention vs. comparable YouTube videos. >0.5 means
   * "outperforming similar videos" at this timestamp. Can be omitted by
   * the API for very small audiences; we render it only when present.
   */
  relativeRetentionPerformance: number | null;
}

export interface TrafficSourceShare {
  /**
   * YouTube's `insightTrafficSourceType` enum, e.g. "YT_SEARCH",
   * "SUGGESTED_VIDEO", "EXT_URL", "SHORTS", "BROWSE", "PLAYLIST".
   * We pretty-print these in the UI.
   */
  sourceType: string;
  views: number;
  watchTimeMinutes: number;
}

/**
 * Top countries for ONE video over the last N days. Same shape as
 * getTopCountries but filtered. YouTube applies the same small-channel
 * privacy thresholds as the channel-level call — expect empty rows for
 * Shorts under ~500 views.
 */
export async function getVideoCountries(
  videoId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<CountryViewShare[]> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'country',
    filters: `video==${videoId}`,
    sort: '-views',
    maxResults: '10',
  })) as { rows?: Array<[string, number, number]> };
  return (data.rows ?? []).map(([countryCode, views, watchTimeMinutes]) => ({
    countryCode,
    views,
    watchTimeMinutes,
  }));
}

/**
 * Age × gender viewer percentages for ONE video. Same threshold caveats
 * as getAgeGenderShare — needs ~100+ views per cohort to populate.
 */
export async function getVideoAgeGender(
  videoId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<AgeGenderShare[]> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'viewerPercentage',
    dimensions: 'ageGroup,gender',
    filters: `video==${videoId}`,
  })) as { rows?: Array<[string, string, number]> };
  return (data.rows ?? []).map(([ageGroup, gender, viewerPercentage]) => ({
    ageGroup,
    gender: (gender as AgeGenderShare['gender']) ?? 'unknown',
    viewerPercentage,
  }));
}

/**
 * Audience retention curve: 100 sample points across the video's
 * runtime. YouTube returns elapsedVideoTimeRatio in 0.01 increments
 * (so 101 rows). Reading: a flat curve at 1.0 means everyone watches
 * to the end; a steep cliff at 0.05 means people drop off in the first
 * 5%. The relativeRetentionPerformance dimension is supported only when
 * the video has enough views — we treat it as optional.
 */
export async function getVideoRetention(
  videoId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<RetentionPoint[]> {
  // The two metrics are returned as separate columns in the same row.
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'audienceWatchRatio,relativeRetentionPerformance',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${videoId}`,
    sort: 'elapsedVideoTimeRatio',
  })) as { rows?: Array<[number, number, number?]> };
  return (data.rows ?? []).map(([elapsedRatio, awr, rrp]) => ({
    elapsedRatio,
    audienceWatchRatio: awr,
    relativeRetentionPerformance: typeof rrp === 'number' ? rrp : null,
  }));
}

/**
 * Where the views came from. The `insightTrafficSourceType` enum is
 * documented at https://developers.google.com/youtube/analytics/dimensions#Traffic_Source_Dimensions
 * and includes "YT_SEARCH" (in-app search), "SUGGESTED_VIDEO" (sidebar/
 * up-next), "BROWSE" (home/subscriptions feed), "EXT_URL" (external
 * referrers), "SHORTS" (Shorts shelf), "PLAYLIST", "DIRECT_OR_UNKNOWN".
 */
export async function getVideoTrafficSources(
  videoId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<TrafficSourceShare[]> {
  const data = (await analyticsQuery({
    ids: 'channel==MINE',
    startDate: isoDaysAgo(windowDays),
    endDate: todayIso(),
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'insightTrafficSourceType',
    filters: `video==${videoId}`,
    sort: '-views',
  })) as { rows?: Array<[string, number, number]> };
  return (data.rows ?? []).map(([sourceType, views, watchTimeMinutes]) => ({
    sourceType,
    views,
    watchTimeMinutes,
  }));
}
