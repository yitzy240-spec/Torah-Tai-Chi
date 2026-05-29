// dashboard/scripts/storyblok-add-x-social.ts
//
// One-shot: add the X (Twitter) social URL + handle to Storyblok's
// site-text folder, and update the Facebook handle to '@torahtaichi'
// (Yonah 2026-05-29 noted '/torahtaichi' read wrong on the about page).
// Idempotent — upsertSiteText updates if the key exists.
//
// Run from repo root: cd dashboard && npx tsx scripts/storyblok-add-x-social.ts

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
  ['social.url.x',          'https://x.com/torahtaichi', 'Public X (Twitter) profile URL'],
  ['social.handle.x',       '@torahtaichi',              'X (Twitter) handle for the about page'],
  ['social.handle.facebook','@torahtaichi',              'Facebook display handle (was /torahtaichi)'],
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
