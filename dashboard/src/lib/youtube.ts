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
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
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
async function getAccessToken(): Promise<string> {
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
