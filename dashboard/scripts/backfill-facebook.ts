// dashboard/scripts/backfill-facebook.ts
//
// One-shot: post the back-catalog of 4 published videos to Facebook
// (newly connected channel) using each video's prior Instagram caption.
//
// Run:
//   cd dashboard
//   npx tsx scripts/backfill-facebook.ts --dry-run   # preview only
//   npx tsx scripts/backfill-facebook.ts             # fires Buffer
//
// Env: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
//      BUFFER_ACCESS_TOKEN. The runner is expected to source these from
//      .env.local.fromvercel (pulled via `vercel env pull`) so the
//      Buffer calls hit the same channel set the dashboard uses.

import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Load env files in priority order — secrets are split across the
// repo (BUFFER_ACCESS_TOKEN + SUPABASE_SERVICE_ROLE_KEY in root .env,
// NEXT_PUBLIC_SUPABASE_URL in website/.env.local). dotenv@17's
// auto-injection got finicky in scripts (parses fine but doesn't set
// process.env), so we parse manually and assign — explicit, no
// surprises. Earlier entries win because we keep the first non-empty
// value seen for each key.
const ENV_CANDIDATES = [
  'dashboard/.env.production.local',
  '.env',
  'website/.env.local',
];
const repoRoot = resolve(process.cwd(), '..');
for (const rel of ENV_CANDIDATES) {
  const p = resolve(repoRoot, rel);
  if (!existsSync(p)) continue;
  const parsed = parseEnv(readFileSync(p));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined && v) process.env[k] = v;
  }
}

import { autoPost } from '../src/lib/auto-post';
import { createServiceClient } from '../src/lib/supabase/service';

const VIDEOS = [
  { id: 'd5385325-2a9f-42c9-8971-bbd94ea3bdfc', parsha: 'Emor' },
  { id: 'a44607b3-8fcd-4f9b-a9d4-1d8c85208542', parsha: 'Behar' },
  { id: 'a11098d8-3aff-4b09-85ea-7c1cc89ffdf2', parsha: 'Bamidbar' },
  { id: '46509909-e8f5-4bd0-ba11-d56ca71d475d', parsha: 'Shavuot' },
];

async function getIgCaption(videoId: string): Promise<string | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from('posts')
    .select('caption, published_at')
    .eq('video_id', videoId)
    .eq('platform', 'instagram')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.caption as string | null) ?? null;
}

async function alreadyPostedToFacebook(videoId: string): Promise<boolean> {
  const sb = createServiceClient();
  const { data } = await sb
    .from('posts')
    .select('id')
    .eq('video_id', videoId)
    .eq('platform', 'facebook')
    .eq('status', 'published')
    .limit(1)
    .maybeSingle();
  return data != null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '[dry-run] no Buffer calls will be made' : '[live] will fire Buffer posts');

  for (const v of VIDEOS) {
    const alreadyOnFb = await alreadyPostedToFacebook(v.id);
    if (alreadyOnFb) {
      console.log(`[skip] ${v.parsha}: already has a published Facebook post`);
      continue;
    }
    const igCaption = await getIgCaption(v.id);
    if (!igCaption) {
      console.warn(`[skip] ${v.parsha} (${v.id}): no prior IG caption found`);
      continue;
    }
    const preview = igCaption.slice(0, 80).replace(/\n/g, ' ');
    console.log(`[plan] ${v.parsha} → Facebook: "${preview}${igCaption.length > 80 ? '…' : ''}"`);

    if (dryRun) continue;

    const result = await autoPost({
      videoId: v.id,
      captions: { facebook: igCaption },
      selectedPlatforms: ['facebook'],
      scheduledAt: new Date(),
      shareNow: true,
    });
    if (result.error) {
      console.error(`[FAIL] ${v.parsha}: ${result.error}`);
      // Stop on first failure so order is preserved on the FB feed.
      // User can re-run; the already-posted guard above prevents dupes.
      process.exit(1);
    }
    const fbResult = result.results?.find((r) => r.platform === 'facebook');
    console.log(`[ok] ${v.parsha}: buffer_update_id=${fbResult?.externalId ?? '?'}`);
    // Pause so FB receives them in order, not all at the same instant.
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
