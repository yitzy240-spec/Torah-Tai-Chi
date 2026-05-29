// dashboard/scripts/storyblok-sync-socials.ts
//
// Pull the actual public URLs + handles for every connected social
// channel — Buffer for IG/FB/X, YouTube oauth_tokens for YT — and
// upsert them into Storyblok's site-text store. Replaces the
// 2026-05-29 hardcoded @torahtaichi guesses with the real
// service_usernames Yonah has wired up.
//
// Run: cd dashboard && npx tsx scripts/storyblok-sync-socials.ts

import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Strip a leading '@' so URL construction is consistent regardless of
// how Buffer formats service_username for a given network.
function stripAt(s: string): string {
  return s.replace(/^@/, '');
}

// service → (handle, url) builder. Public-profile URL conventions are
// per-platform; YouTube prefers @handle when available.
type Built = { url: string; handle: string };
function buildUrl(service: string, rawHandle: string): Built {
  const handle = stripAt(rawHandle).trim();
  if (!handle) return { url: '', handle: '' };
  switch (service) {
    case 'instagram':
      return { url: `https://instagram.com/${handle}`,   handle: `@${handle}` };
    case 'facebook':
      // Buffer's FB service_username is typically the Page handle/vanity URL.
      return { url: `https://facebook.com/${handle}`,    handle: `@${handle}` };
    case 'twitter':
      return { url: `https://x.com/${handle}`,           handle: `@${handle}` };
    case 'youtube':
      return { url: `https://youtube.com/@${handle}`,    handle: `@${handle}` };
    default:
      return { url: '', handle: '' };
  }
}

async function main() {
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!bufferToken) throw new Error('BUFFER_ACCESS_TOKEN missing');

  const { listProfiles } = await import('../src/lib/buffer');
  const profiles = await listProfiles(bufferToken);

  console.log('[buffer] channels:');
  for (const p of profiles) {
    console.log(`  ${p.service.padEnd(10)} → ${p.service_username}`);
  }

  // Map Buffer service names to our CMS slugs (twitter → x in the CMS).
  const SERVICE_TO_CMS: Record<string, string> = {
    instagram: 'instagram',
    facebook:  'facebook',
    twitter:   'x',
  };

  const built: Record<string, Built> = {};
  for (const p of profiles) {
    const cms = SERVICE_TO_CMS[p.service];
    if (!cms) continue;
    built[cms] = buildUrl(p.service, p.service_username);
  }

  // YouTube: from oauth_tokens.account_name (channel handle/title).
  const { createServiceClient } = await import('../src/lib/supabase/service');
  const sb = createServiceClient();
  const { data: ytRow } = await sb
    .from('oauth_tokens')
    .select('account_id, account_name')
    .eq('service', 'youtube')
    .maybeSingle();
  if (ytRow?.account_name) {
    built.youtube = buildUrl('youtube', ytRow.account_name as string);
    console.log(`[youtube]  → ${ytRow.account_name}`);
  } else if (ytRow?.account_id) {
    // Fall back to channel-id URL if no handle is stored.
    built.youtube = {
      url: `https://youtube.com/channel/${ytRow.account_id}`,
      handle: `Channel ${(ytRow.account_id as string).slice(0, 8)}…`,
    };
    console.log(`[youtube]  → channel/${ytRow.account_id} (no handle)`);
  } else {
    console.log('[youtube]  → NOT CONNECTED (skipping)');
  }

  // Upsert to Storyblok.
  const { upsertSiteText } = await import('../src/lib/storyblok');
  for (const [cms, b] of Object.entries(built)) {
    if (!b.url) continue;
    process.stdout.write(`[upsert] social.url.${cms}    = ${b.url}  …`);
    try {
      await upsertSiteText(`social.url.${cms}`, b.url, `Public ${cms} profile URL`);
      console.log(' ok');
    } catch (e) {
      console.log(' FAIL');
      console.error(`  ${(e as Error).message}`);
      process.exit(1);
    }
    process.stdout.write(`[upsert] social.handle.${cms} = ${b.handle}  …`);
    try {
      await upsertSiteText(`social.handle.${cms}`, b.handle, `${cms} display handle`);
      console.log(' ok');
    } catch (e) {
      console.log(' FAIL');
      console.error(`  ${(e as Error).message}`);
      process.exit(1);
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
