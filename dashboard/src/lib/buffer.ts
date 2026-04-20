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

async function gql<T>(token: string, query: string, variables?: object): Promise<T> {
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Buffer GraphQL: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Buffer GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('Buffer GraphQL: empty response');
  return body.data;
}

interface AccountChannelsResponse {
  account: {
    organizations: Array<{
      channels: Array<{
        id: string;
        service: string | null;
        name: string | null;
        displayName: string | null;
        isDisconnected: boolean;
      }>;
    }>;
  };
}

const LIST_CHANNELS_QUERY = `
  query ListChannels {
    account {
      organizations {
        channels {
          id
          service
          name
          displayName
          isDisconnected
        }
      }
    }
  }
`;

export async function listProfiles(token: string): Promise<BufferProfile[]> {
  const data = await gql<AccountChannelsResponse>(token, LIST_CHANNELS_QUERY);
  const channels = data.account?.organizations?.flatMap((o) => o.channels ?? []) ?? [];
  return channels
    .filter((c) => !c.isDisconnected && c.service)
    .map((c) => ({
      id: c.id,
      service: (c.service ?? '').toLowerCase(),
      service_username: c.displayName ?? c.name ?? '',
      formatted_service: (c.service ?? '').replace(/^\w/, (m) => m.toUpperCase()),
    }));
}

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
  /** If set + not shareNow, Buffer schedules the post at this time. */
  scheduledAt?: Date;
  /** If true, publish immediately instead of queuing/scheduling. */
  shareNow?: boolean;
  /** Lowercase Buffer service (instagram/tiktok/facebook/youtube/twitter)
   *  for the target channel. Used to attach per-network metadata — e.g.
   *  Instagram rejects posts without a type hint (post | story | reel). */
  channelService?: string;
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

  const assets = a.mediaUrl
    ? a.mediaType === 'image'
      ? { images: [{ url: a.mediaUrl }] }
      : { videos: [{ url: a.mediaUrl }] }
    : undefined;

  // Per-network metadata. Instagram rejects createPost with media unless a
  // post type is specified (post / story / reel); use 'post' for images,
  // 'reel' for videos since Shorts-style vertical videos are our default.
  const metadata: Record<string, unknown> = {};
  if (a.channelService === 'instagram' && assets) {
    metadata.instagram = { type: a.mediaType === 'video' ? 'reel' : 'post' };
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

  const data = await gql<CreatePostResponse>(a.token, CREATE_POST_MUTATION, { input });
  const r = data.createPost;
  if ('post' in r && r.post) return r.post;
  const reason = 'message' in r ? r.message : r.__typename;
  throw new Error(`Buffer createUpdate (${a.channelId}): ${reason}`);
}
