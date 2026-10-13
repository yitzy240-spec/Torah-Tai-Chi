// dashboard/scripts/storyblok-add-tiktok-social.ts
//
// One-shot: add the TikTok social URL + handle to Storyblok's site-text
// folder. TikTok replaced X in the website's profile links (nav, footer,
// about, JSON-LD) on 2026-10-13. Until these keys exist in Storyblok the
// site renders the hardcoded fallbacks in website/src/lib/site-content.ts
// and the dashboard's /site-content page has no TikTok row to edit.
// Idempotent — upsertSiteText updates if the key exists (e.g. a stale
// value left over from the pre-2026-05-28 TikTok era).
//
// Run from repo root: cd dashboard && npx tsx scripts/storyblok-add-tiktok-social.ts

import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load env BEFORE any module that reads it at import time. storyblok.ts
// caches process.env.STORYBLOK_* in module-level consts on first
// evaluation, so a static `import { upsertSiteText }` would lock in
// undefineds. Dynamic-import after env-load fixes that.
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

const UPDATES: Array<[string, string, string?]> = [
  ['social.url.tiktok',    'https://www.tiktok.com/@torahtaichi', 'Public TikTok profile URL'],
  ['social.handle.tiktok', '@torahtaichi',                        'TikTok handle for the about page'],
];

async function main() {
  const { upsertSiteText } = await import('../src/lib/storyblok');
  for (const [key, value, description] of UPDATES) {
    process.stdout.write(`[upsert] ${key} = ${value}  …`);
    try {
      await upsertSiteText(key, value, description);
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
