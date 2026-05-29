// One-shot: revert FB + YT to the previously-good vanity URLs.
// Buffer's service_username for FB Page / YT channel returns the
// display NAME ('Torah Tai Chi' with spaces), not the vanity URL
// slug. The previous sync wrote broken URLs.
import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const rel of ['dashboard/.env.production.local', '.env', 'website/.env.local']) {
  const p = resolve(process.cwd(), '..', rel);
  if (!existsSync(p)) continue;
  const parsed = parseEnv(readFileSync(p));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined && v) process.env[k] = v;
  }
}

const FIXES: Array<[string, string]> = [
  ['social.url.facebook',    'https://facebook.com/torahtaichi'],
  ['social.handle.facebook', '@torahtaichi'],
  ['social.url.youtube',     'https://youtube.com/@torahtaichi'],
  ['social.handle.youtube',  '@torahtaichi'],
];

(async () => {
  const { upsertSiteText } = await import('../src/lib/storyblok');
  for (const [key, value] of FIXES) {
    process.stdout.write(`[fix] ${key} = ${value}  …`);
    try {
      await upsertSiteText(key, value);
      console.log(' ok');
    } catch (e) {
      console.log(' FAIL');
      console.error(`  ${(e as Error).message}`);
      process.exit(1);
    }
  }
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
