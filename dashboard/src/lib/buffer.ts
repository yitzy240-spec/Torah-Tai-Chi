/**
 * Buffer v2 GraphQL client.
 *
 * Buffer deprecated the legacy REST API at api.bufferapp.com in favor of the
 * GraphQL endpoint at api.buffer.com/graphql. Personal-access tokens issued
 * after 2025 are OIDC-based and only accepted by the GraphQL endpoint.
 *
 * We keep the public surface (`listProfiles`, `createUpdate`) shaped the same
 * as the old REST client so callers don't have to change.
 */

import { unstable_cache } from 'next/cache';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { BufferApiError } from '@/lib/buffer-shared';

const BUFFER_GRAPHQL = 'https://api.buffer.com/graphql';

export type BufferProfile = {
  /** Buffer channel id (NB: called "id" on the channel object in v2). */
  id: string;
  /** Lowercase service name, e.g. "tiktok" | "instagram" | "youtube" | "facebook" | "twitter". */
  service: string;
  /** Display handle for the channel. */
  service_username: string;
  /** Kept for backwards compatibility with old REST shape; just the capitalised service. */
  formatted_service: string;
};

/**
 * Every invocation of this function costs 1 of Buffer's 100/day budget.
 * The label log line is the permanent audit trail — Vercel runtime logs
 * answer "who called Buffer today and how often" (2026-06-10 incident).
 */
async function gql<T>(
  token: string,
  query: string,
  variables?: object,
  label = 'unlabeled',
): Promise<T> {
  console.log(`[buffer] gql ${label}`);
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const resetRaw = res.headers.get('x-ratelimit-reset');
    const reset = resetRaw ? Number(resetRaw) : null;
    throw new BufferApiError(res.status, Number.isFinite(reset) ? reset : null);
  }
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Buffer GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('Buffer GraphQL: empty response');
  return body.data;
}

interface ChannelsResponse {
  channels: Array<{
    id: string;
    service: string | null;
    name: string | null;
    displayName: string | null;
    isDisconnected: boolean;
  }>;
}

// Buffer's "new" API (launched 2026) forbids the nested
// account.organizations.channels field for personal API keys — it returns
// FORBIDDEN / data:null even though account + organizations resolve fine.
// The supported path is the top-level channels(input:) query, which works
// with the same key (no extra scope, no plan upgrade). Verified 2026-06-23
// after Yonah's Instagram posts failed with "No Buffer profile found".
const LIST_CHANNELS_QUERY = `
  query ListChannels($orgId: OrganizationId!) {
    channels(input: { organizationId: $orgId }) {
      id
      service
      name
      displayName
      isDisconnected
    }
  }
`;

const POST_LINKS_QUERY = `
  query PostLinks($orgId: OrganizationId!) {
    posts(input: { organizationId: $orgId }, first: 50) {
      edges { node { id status externalLink } }
    }
  }
`;

interface PostsResponse {
  posts: {
    edges: Array<{
      node: { id: string; status: string; externalLink: string | null };
    }>;
  };
}

// Org id for a Buffer token never changes (the token IS scoped to one
// account/org). Cache for 24h — would be safe to cache forever; 24h is
// just a defensive ceiling in case the token gets reissued and the
// dashboard happens to be using an old deploy.
async function getOrgIdUncached(token: string): Promise<string> {
  const data = await gql<{ account: { organizations: Array<{ id: string }> } }>(
    token,
    `{ account { organizations { id } } }`,
    undefined,
    'org-id',
  );
  const id = data.account?.organizations?.[0]?.id;
  if (!id) throw new Error('No Buffer organization');
  return id;
}

// Supabase-first: the org id lives on the buffer_profiles_cache row
// (it's immutable per token). Live Buffer fetch only when the row
// doesn't have it yet; persisted lazily so the next cold instance
// reads it from Supabase instead of Buffer.
async function orgIdSupabaseFirst(token: string): Promise<string> {
  const row = await readCacheRow(token);
  if (row?.org_id) return row.org_id;
  const id = await getOrgIdUncached(token); // 1 live Buffer call
  if (row) {
    // Persist only when the row already exists — inserting a stub row
    // with empty profiles would make profilesSupabaseFirst serve [] forever.
    const sb = createServiceClient();
    const { error } = await sb
      .from('buffer_profiles_cache')
      .update({ org_id: id })
      .eq('token_hash', tokenHash(token));
    if (error) console.error('[buffer] org_id persist failed:', error.message);
  }
  return id;
}

// Thin 24h wrapper purely to avoid a Supabase read per render. No tags —
// nothing should ever bust this into a Buffer call, and even an implicit
// revalidatePath bust only triggers a Supabase re-read.
const getOrgId = unstable_cache(
  async (token: string) => orgIdSupabaseFirst(token),
  ['buffer-org-id-v2'],
  { revalidate: 86400 },
);

/**
 * Fetch the platform-direct URL for a set of Buffer post ids.
 * Returns a map of id → externalLink (may be null if the post is still
 * queued/scheduled and hasn't been published to the network yet).
 *
 * 1-hour cache: callers (refreshVideoPostUrls) already filter to posts
 * with post_url IS NULL — so once we resolve a URL, it gets written to
 * the DB and we never ask Buffer about that id again. The cache here
 * only matters for posts still in flight (Buffer hasn't returned the
 * platform URL yet, typically 1-5 min after the post hits Buffer). For
 * those, asking Buffer once an hour instead of on every page render is
 * the right cadence — and prevents LiveAtRest from re-hitting Buffer
 * every time Yonah refreshes /videos/[slug].
 */
async function getPostExternalLinksUncached(
  token: string,
  postIds: string[],
): Promise<Record<string, string | null>> {
  if (postIds.length === 0) return {};
  const orgId = await getOrgId(token);
  const data = await gql<PostsResponse>(token, POST_LINKS_QUERY, { orgId }, 'post-links');
  const wanted = new Set(postIds);
  const out: Record<string, string | null> = {};
  for (const { node } of data.posts.edges ?? []) {
    if (wanted.has(node.id)) out[node.id] = node.externalLink;
  }
  // Any id not seen in the page of 50 is just not resolved yet.
  for (const id of postIds) if (!(id in out)) out[id] = null;
  return out;
}

export const getPostExternalLinks = unstable_cache(
  async (token: string, postIds: string[]) => getPostExternalLinksUncached(token, postIds),
  ['buffer-post-external-links'],
  { revalidate: 3600, tags: ['buffer-post-links'] },
);

// Exported for /channels page, which IS the freshness source-of-truth
// (the page Yonah visits after connecting/disconnecting platforms in
// Buffer's UI). Always hits Buffer + writes through to the cache so
// subsequent listProfiles calls everywhere else immediately see the
// new channel set.
export async function listProfilesFresh(token: string): Promise<BufferProfile[]> {
  const profiles = await listProfilesUncached(token);
  await writeCachedProfiles(token, profiles).catch((e) => {
    console.warn('[buffer] cache write-through failed:', (e as Error).message);
  });
  return profiles;
}

async function listProfilesUncached(token: string): Promise<BufferProfile[]> {
  const orgId = await getOrgId(token);
  const data = await gql<ChannelsResponse>(token, LIST_CHANNELS_QUERY, { orgId }, 'list-profiles');
  const channels = data.channels ?? [];
  return channels
    .filter((c) => !c.isDisconnected && c.service)
    .map((c) => ({
      id: c.id,
      service: (c.service ?? '').toLowerCase(),
      service_username: c.displayName ?? c.name ?? '',
      formatted_service: (c.service ?? '').replace(/^\w/, (m) => m.toUpperCase()),
    }));
}

// ─── Supabase-backed PRIMARY store (2026-06-10 inversion) ────────────────
// buffer_profiles_cache is the primary source for profiles + org id, not
// a fallback. Buffer GraphQL is only contacted by: the daily buffer-health
// cron warm refresh, explicit /channels visits (listProfilesFresh), post
// mutations, and a single-flight cold bootstrap when no row exists.
// History: Yonah kept hitting Buffer's 100/day cap mid-session because
// every save action's revalidatePath bust made the next render re-hit
// Buffer live — and this table (the intended safety net) was never
// actually created in prod. See the 2026-06-10 spec for the full story.

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type CacheRow = { profiles: BufferProfile[]; org_id: string | null };

async function readCacheRow(token: string): Promise<CacheRow | null> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('buffer_profiles_cache')
    .select('profiles, org_id')
    .eq('token_hash', tokenHash(token))
    .maybeSingle();
  if (error || !data) return null;
  return {
    profiles: data.profiles as BufferProfile[],
    org_id: (data.org_id as string | null) ?? null,
  };
}

async function writeCachedProfiles(token: string, profiles: BufferProfile[]): Promise<void> {
  const sb = createServiceClient();
  // supabase-js does NOT reject on failure — it resolves with { error }.
  // Ignoring that (the pre-2026-06-10 behavior) is how five weeks of
  // writes to a nonexistent table failed without a single log line.
  const { error } = await sb
    .from('buffer_profiles_cache')
    .upsert({
      token_hash: tokenHash(token),
      profiles: profiles as unknown as object,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`buffer_profiles_cache upsert failed: ${error.message}`);
}

/**
 * Strict daily warm refresh for the buffer-health cron: live-fetch the
 * channel list and write it through, THROWING if the cache write fails
 * so the cron can alarm. (listProfilesFresh stays best-effort because
 * its caller is the /channels page render.)
 */
export async function refreshProfilesCache(token: string): Promise<number> {
  const profiles = await listProfilesUncached(token);
  await writeCachedProfiles(token, profiles);
  return profiles.length;
}

// Single-flight: concurrent cold-bootstrap renders share ONE live Buffer
// call per serverless instance instead of stampeding.
const inflightProfiles = new Map<string, Promise<BufferProfile[]>>();

// Supabase-FIRST (2026-06-10 inversion — see spec
// docs/superpowers/specs/2026-06-10-buffer-rate-limit-fix-design.md):
//   1. Serve the buffer_profiles_cache row regardless of age. Profiles
//      change ~monthly; /channels (listProfilesFresh) and the daily
//      buffer-health cron keep the row ≤24h stale.
//   2. Only if NO row exists (true cold bootstrap), make one live
//      Buffer call and write through.
// This makes revalidatePath busts harmless: a busted render re-reads
// Supabase (free), not Buffer (100/day). The old order — Buffer first,
// Supabase only on error — burned the daily budget during normal
// editing sessions and is what kept locking Yonah out at post time.
async function profilesSupabaseFirst(token: string): Promise<BufferProfile[]> {
  const row = await readCacheRow(token);
  if (row) return row.profiles;
  const key = tokenHash(token);
  let p = inflightProfiles.get(key);
  if (!p) {
    p = (async () => {
      try {
        const fresh = await listProfilesUncached(token);
        await writeCachedProfiles(token, fresh).catch((e) => {
          console.error(
            '[buffer] CACHE WRITE FAILED — every render will hit Buffer live until fixed:',
            (e as Error).message,
          );
        });
        return fresh;
      } finally {
        inflightProfiles.delete(key);
      }
    })();
    inflightProfiles.set(key, p);
  }
  return p;
}

// Thin 5-min wrapper purely to keep Supabase IO down (one SQL read per
// 5 min per instance instead of per render). NO tags and a NEW key —
// nothing should ever bust this into a Buffer call, and even when
// revalidatePath busts it implicitly, the refetch is a Supabase read.
export const listProfiles = unstable_cache(
  async (token: string) => profilesSupabaseFirst(token),
  ['buffer-list-profiles-v2'],
  { revalidate: 300 },
);

export type CreateUpdateArgs = {
  token: string;
  /** Buffer channel id to post to. One post per mutation — callers fan
   *  out across platforms themselves (see scheduleAll). */
  channelId: string;
  /** Caption / post text. */
  text: string;
  /** Publicly reachable media URL. */
  mediaUrl?: string;
  /** Whether mediaUrl is a video or an image. Defaults to video. */
  mediaType?: 'video' | 'image';
  /** Publicly reachable thumbnail URL for the cover frame on video posts.
   *  Buffer's May 2026 schema uses assets[i].video.thumbnailUrl (array
   *  of asset objects, not the old {videos:[...]} shape). We pass our
   *  pre-extracted thumb whenever we have one — no harm if a network
   *  ignores it, and IG/FB Reels typically use it for the grid cover. */
  thumbnailUrl?: string;
  /** If set + not shareNow, Buffer schedules the post at this time. */
  scheduledAt?: Date;
  /** If true, publish immediately instead of queuing/scheduling. */
  shareNow?: boolean;
  /** Lowercase Buffer service (instagram/tiktok/facebook/youtube/twitter)
   *  for the target channel. Used to attach per-network metadata — e.g.
   *  Instagram rejects posts without a type hint (post | story | reel). */
  channelService?: string;
  /** Operator override for Facebook post-type. When set, overrides the
   *  media-kind default ('reel' for video, 'post' for image). Required
   *  because Yonah's FB card lets the operator pick Reel vs Post but
   *  the toggle was a phantom — auto-post forced the default. */
  facebookType?: 'reel' | 'post';
  /** Auto-comment posted immediately after the main post publishes.
   *  Sent via metadata.<platform>.firstComment per Buffer's GraphQL
   *  schema (added Feb 2026). Works on FB; Buffer has an open issue
   *  where IG silently drops it — we pass it anyway so it lights up
   *  whenever they fix it. */
  firstComment?: string;
};

interface CreatePostResponse {
  createPost: { __typename: 'PostActionSuccess'; post: { id: string; status: string } }
             | { __typename: 'NotFoundError' | 'UnauthorizedError' | 'UnexpectedError' | string; message: string };
}

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
    }
  }
`;

/**
 * Create a Buffer post on a single channel. Buffer's GraphQL API requires
 * one mutation per channel (unlike the old REST API which accepted an array
 * of profile_ids); callers that want multi-channel posting fan out at their
 * own level (see scheduleAll).
 */
export async function createUpdate(a: CreateUpdateArgs): Promise<{ id: string; status: string }> {
  const mode = a.shareNow
    ? 'shareNow'
    : a.scheduledAt
    ? 'customScheduled'
    : 'addToQueue';

  // Buffer May 2026 schema overhaul: assets is now an array of typed
  // asset objects rather than a keyed object ({videos:[...]} is gone).
  // New shape: [{image:{url}}, ...] or [{video:{url, thumbnailUrl?}}, ...].
  const assets = a.mediaUrl
    ? a.mediaType === 'image'
      ? [{ image: { url: a.mediaUrl } }]
      : [{
          video: {
            url: a.mediaUrl,
            ...(a.thumbnailUrl ? { thumbnailUrl: a.thumbnailUrl } : {}),
          },
        }]
    : undefined;

  // Per-network metadata. Instagram and Facebook both require a post-type
  // hint (post / reel / story). TikTok and Twitter accept additional
  // optional metadata, but Buffer's API surface for those is sparse —
  // see CreateUpdateArgs JSDoc and the audit note in commit 00b88d4 for
  // why deeper TikTok controls (privacy, duet, stitch) aren't reachable.
  const metadata: Record<string, Record<string, unknown>> = {};
  if (a.channelService === 'instagram' && assets) {
    // Buffer requires BOTH `type` and `shouldShareToFeed` — the latter controls
    // whether the reel/post also appears in the main feed (reels default to
    // sharing to feed; images are always feed posts).
    metadata.instagram = {
      type: a.mediaType === 'video' ? 'reel' : 'post',
      shouldShareToFeed: true,
      ...(a.firstComment ? { firstComment: a.firstComment } : {}),
    };
  }
  if (a.channelService === 'facebook' && assets) {
    // PostTypeFacebook is non-nullable on FacebookPostMetadataInput per
    // Buffer's schema. Default to 'reel' for video / 'post' for image;
    // operator can override via facebookType (FB card's Reel/Post toggle).
    metadata.facebook = {
      type: a.facebookType ?? (a.mediaType === 'video' ? 'reel' : 'post'),
      ...(a.firstComment ? { firstComment: a.firstComment } : {}),
    };
  }

  const input = {
    text: a.text,
    mode,
    schedulingType: 'automatic',
    channelId: a.channelId,
    ...(mode === 'customScheduled' && a.scheduledAt ? { dueAt: a.scheduledAt.toISOString() } : {}),
    ...(assets ? { assets } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  const data = await gql<CreatePostResponse>(a.token, CREATE_POST_MUTATION, { input }, 'create-post');
  const r = data.createPost;
  if ('post' in r && r.post) return r.post;
  const reason = 'message' in r ? r.message : r.__typename;
  throw new Error(`Buffer createUpdate (${a.channelId}): ${reason}`);
}

// ── editPost + deletePost mutations (for edit-posted.ts Branch A and Branch B) ────────────────

interface EditPostResponse {
  editPost:
    | { __typename: 'PostActionSuccess'; post: { id: string; status: string } }
    | { __typename: string; message?: string };
}

interface DeletePostResponse {
  deletePost:
    | { __typename: 'PostActionSuccess'; post: { id: string } }
    | { __typename: string; message?: string };
}

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
    }
  }
`;

const DELETE_POST_MUTATION = `
  mutation DeletePost($id: PostId!) {
    deletePost(input: { id: $id }) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on NotFoundError { message }
      ... on UnexpectedError { message }
    }
  }
`;

/**
 * Edit an existing Buffer post in-place (Branch A of the editPost spec §13).
 * Only valid if Buffer's editPost mutation accepts already-published posts.
 * Verification is gated on tools/test_buffer_edit_post.ts being run.
 */
export async function editPostBuffer(args: {
  token: string;
  postId: string;
  text: string;
}): Promise<{ id: string; status: string }> {
  const data = await gql<EditPostResponse>(args.token, EDIT_POST_MUTATION, {
    input: { id: args.postId, text: args.text },
  }, 'edit-post');
  const r = data.editPost;
  if (r.__typename === 'PostActionSuccess' && 'post' in r) return r.post as { id: string; status: string };
  const reason = 'message' in r ? r.message : r.__typename;
  throw new Error(`Buffer editPost (${args.postId}): ${reason}`);
}

/**
 * Delete an existing Buffer post (Branch B of the editPost spec §13 — used before reposting).
 */
export async function deletePostBuffer(args: {
  token: string;
  postId: string;
}): Promise<void> {
  const data = await gql<DeletePostResponse>(args.token, DELETE_POST_MUTATION, {
    id: args.postId,
  }, 'delete-post');
  const r = data.deletePost;
  if (r.__typename === 'PostActionSuccess') return;
  const reason = 'message' in r ? r.message : r.__typename;
  throw new Error(`Buffer deletePost (${args.postId}): ${reason}`);
}
