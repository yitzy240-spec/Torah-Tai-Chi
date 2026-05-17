/**
 * tools/test_buffer_edit_post.ts
 *
 * One-off verification script: does Buffer's `editPost` GraphQL mutation
 * (added Apr 22 2026) work on a post that has ALREADY been published to a
 * platform?
 *
 * The result of running this script determines which branch Phase 5 of the
 * video-page redesign uses:
 *   Branch A — editPost works → use true in-place edits for social captions
 *   Branch B — editPost fails/no-ops → delete + repost workaround
 *
 * SAFE-USE PROTOCOL (human-gated — see README):
 *   1. List Buffer profiles, find the TikTok channel.
 *   2. Post a clearly-labeled [TEST POST — please ignore] to TikTok via
 *      shareNow=true.
 *   3. Wait ~10 minutes for TikTok publication.
 *   4. Confirm published via getPostExternalLinks (externalLink resolved).
 *   5. Call editPost mutation with new text.
 *   6. Wait ~5 minutes for propagation. Operator manually checks TikTok URL.
 *   7. Delete the test post via deletePost.
 *
 * Usage (from repo root):
 *   tsx --env-file=.env tools/test_buffer_edit_post.ts
 *
 * Required env vars (from .env / dashboard/.env.local):
 *   BUFFER_ACCESS_TOKEN  — Buffer personal-access token
 *   TEST_MP4_URL         — publicly reachable small .mp4 to attach
 *                          (TikTok rejects text-only video posts)
 *
 * DO NOT run this script without reading the README first.
 * It will post a real (briefly visible) video to your TikTok account.
 */

import { listProfiles, createUpdate, getPostExternalLinks } from '../dashboard/src/lib/buffer';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const TEST_MP4_URL = process.env.TEST_MP4_URL;

if (!TOKEN) {
  console.error('ERROR: BUFFER_ACCESS_TOKEN is not set.');
  process.exit(1);
}
if (!TEST_MP4_URL) {
  console.error(
    'ERROR: TEST_MP4_URL is not set.\n' +
      'Set it to a publicly reachable small .mp4 URL (TikTok rejects text-only video posts).',
  );
  process.exit(1);
}

const BUFFER_GRAPHQL = 'https://api.buffer.com/graphql';

const INITIAL_TEXT =
  '[TEST POST — please ignore] Buffer editPost verification test. ' +
  'This post will be edited and deleted within 30 minutes. ' +
  new Date().toISOString();

const EDITED_TEXT =
  '[TEST POST — EDITED — please ignore] Buffer editPost verification test — ' +
  'caption was successfully mutated after publish. ' +
  new Date().toISOString();

// ---------------------------------------------------------------------------
// Raw GraphQL helpers (editPost + deletePost are not in buffer.ts yet)
// ---------------------------------------------------------------------------

async function gqlRaw<T>(query: string, variables?: object): Promise<T> {
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Buffer GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`Buffer GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  if (body.data === undefined) throw new Error('Buffer GraphQL: empty response');
  return body.data;
}

const EDIT_POST_MUTATION = /* GraphQL */ `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on NotFoundError    { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError  { message }
    }
  }
`;

const DELETE_POST_MUTATION = /* GraphQL */ `
  mutation DeletePost($id: PostId!) {
    deletePost(input: { id: $id }) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on NotFoundError    { message }
      ... on UnexpectedError  { message }
    }
  }
`;

interface PostActionSuccess {
  __typename: 'PostActionSuccess';
  post: { id: string; status: string; text?: string };
}
interface PostActionError {
  __typename: string;
  message: string;
}
type PostActionResult = PostActionSuccess | PostActionError;

async function editPost(postId: string, newText: string): Promise<PostActionResult> {
  const data = await gqlRaw<{ editPost: PostActionResult }>(EDIT_POST_MUTATION, {
    input: { id: postId, text: newText },
  });
  return data.editPost;
}

async function deletePost(postId: string): Promise<PostActionResult> {
  const data = await gqlRaw<{ deletePost: PostActionResult }>(DELETE_POST_MUTATION, {
    id: postId,
  });
  return data.deletePost;
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minutes(n: number): number {
  return n * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('Buffer editPost verification — safe-use protocol');
  console.log('='.repeat(70));
  console.log();

  // ------------------------------------------------------------------
  // Step 1: List profiles, find TikTok channel
  // ------------------------------------------------------------------
  console.log('Step 1: Listing Buffer profiles...');
  const profiles = await listProfiles(TOKEN!);
  console.log(
    `  Found ${profiles.length} profile(s):`,
    profiles.map((p) => `${p.service}/${p.service_username}`).join(', '),
  );

  const tikTok = profiles.find((p) => p.service === 'tiktok');
  if (!tikTok) {
    console.error(
      'ERROR: No TikTok channel found in Buffer account.\n' +
        'Connect a TikTok channel in Buffer, then re-run.',
    );
    process.exit(1);
  }
  console.log(`  Using TikTok channel: ${tikTok.service_username} (id=${tikTok.id})`);
  console.log();

  // ------------------------------------------------------------------
  // Step 2: Post the test video immediately via shareNow=true
  // ------------------------------------------------------------------
  console.log('Step 2: Creating test post on TikTok (shareNow=true)...');
  console.log('  Text:', INITIAL_TEXT);
  console.log('  Media:', TEST_MP4_URL);

  const created = await createUpdate({
    token: TOKEN!,
    channelId: tikTok.id,
    text: INITIAL_TEXT,
    mediaUrl: TEST_MP4_URL,
    mediaType: 'video',
    channelService: 'tiktok',
    shareNow: true,
  });
  console.log(`  Post created: id=${created.id}  status=${created.status}`);
  console.log();

  // ------------------------------------------------------------------
  // Step 3: Wait ~10 minutes for TikTok to publish the post
  // ------------------------------------------------------------------
  const PUBLISH_WAIT_MINUTES = 10;
  console.log(`Step 3: Waiting ${PUBLISH_WAIT_MINUTES} minutes for TikTok to publish...`);
  console.log(
    '  (TikTok processes uploads asynchronously; externalLink resolves after publication)',
  );

  for (let i = 1; i <= PUBLISH_WAIT_MINUTES; i++) {
    await sleep(minutes(1));
    process.stdout.write(`  ${i}/${PUBLISH_WAIT_MINUTES} minutes elapsed\r`);
  }
  console.log();
  console.log();

  // ------------------------------------------------------------------
  // Step 4: Confirm published via getPostExternalLinks
  // ------------------------------------------------------------------
  console.log('Step 4: Checking for externalLink (confirms publication on TikTok)...');

  const links = await getPostExternalLinks(TOKEN!, [created.id]);
  const externalLink: string | null = links[created.id] ?? null;

  if (!externalLink) {
    console.error(`   externalLink not resolved — TikTok may still be processing. Aborting.`);
    // Clean up the queued Buffer post before exiting.
    await attemptCleanup(created.id);
    process.exit(2);
  }
  console.log(`  Confirmed published! TikTok URL: ${externalLink}`);
  console.log();

  // ------------------------------------------------------------------
  // Step 5: Call editPost mutation with new text
  // ------------------------------------------------------------------
  console.log('Step 5: Calling editPost mutation...');
  console.log('  New text:', EDITED_TEXT);

  let editResult: PostActionResult;
  try {
    editResult = await editPost(created.id, EDITED_TEXT);
  } catch (err) {
    console.error('  editPost threw an exception:', (err as Error).message);
    console.log();
    console.log('BRANCH DECISION: editPost FAILED (exception) → use Branch B (delete + repost)');
    await attemptCleanup(created.id);
    process.exit(0);
  }

  console.log('  editPost response:', JSON.stringify(editResult, null, 2));
  console.log();

  if (editResult.__typename === 'PostActionSuccess') {
    console.log('editPost returned PostActionSuccess.');
    console.log('  Updated text in Buffer:', editResult.post.text ?? '(not returned)');
    console.log();

    // ------------------------------------------------------------------
    // Step 6: Wait for propagation and ask operator to check manually
    // ------------------------------------------------------------------
    const PROPAGATION_WAIT_MINUTES = 5;
    console.log(`Step 6: Waiting ${PROPAGATION_WAIT_MINUTES} minutes for propagation...`);
    for (let i = 1; i <= PROPAGATION_WAIT_MINUTES; i++) {
      await sleep(minutes(1));
      process.stdout.write(`  ${i}/${PROPAGATION_WAIT_MINUTES} minutes elapsed\r`);
    }
    console.log();
    console.log();

    console.log('='.repeat(70));
    console.log('ACTION REQUIRED: manually check the TikTok post');
    console.log('='.repeat(70));
    console.log(`  URL: ${externalLink}`);
    console.log('  Does the caption now read the EDITED text? (not the original)');
    console.log();
    console.log('  If YES → BRANCH DECISION: editPost WORKS → use Branch A (true edits)');
    console.log('  If NO  → BRANCH DECISION: editPost NO-OPS → use Branch B (delete + repost)');
    console.log();
    console.log('MANUAL CHECK REQUIRED: open the URL above. Does the caption show EDITED text?');
  } else {
    const errMsg = 'message' in editResult ? editResult.message : editResult.__typename;
    console.log(`editPost returned an error typename "${editResult.__typename}": ${errMsg}`);
    console.log();
    console.log('BRANCH DECISION: editPost FAILED (API error) → use Branch B (delete + repost)');
  }

  // ------------------------------------------------------------------
  // Step 7: Delete the test post
  // ------------------------------------------------------------------
  await attemptCleanup(created.id);
}

async function attemptCleanup(postId: string): Promise<void> {
  console.log('Step 7: Deleting test post...');
  try {
    const del = await deletePost(postId);
    if (del.__typename === 'PostActionSuccess') {
      console.log(`  Deleted successfully. Post id=${postId} is gone from Buffer.`);
      console.log(
        '  NOTE: The post may still appear on TikTok for a short period — ' +
          'TikTok deletions propagate asynchronously.',
      );
    } else {
      const msg = 'message' in del ? del.message : del.__typename;
      console.warn(`  deletePost returned "${del.__typename}": ${msg}`);
      console.warn(`  You may need to delete post id=${postId} manually in Buffer.`);
    }
  } catch (err) {
    console.error(
      `  deletePost threw an exception: ${(err as Error).message}\n` +
        `  Delete post id=${postId} manually in Buffer → https://publish.buffer.com`,
    );
  }
  console.log();
  console.log('Done. Update docs/superpowers/specs/*-video-page-redesign.md § 13 with findings.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
