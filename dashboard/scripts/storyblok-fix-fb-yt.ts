// One-shot: set FB + YT to the real connected URLs Yonah confirmed
// (2026-05-29). FB Page hasn't claimed a vanity URL so the canonical
// URL is the /people/<name>/<numeric_id>/ form; display handle is the
// Page name. YouTube @handle is TorahTai_Chi (underscore).
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
  ['social.url.facebook',    'https://www.facebook.com/people/Torah-Tai-Chi/61590370923943/'],
  ['social.handle.facebook', 'Torah Tai Chi'],
  ['social.url.youtube',     'https://www.youtube.com/@TorahTai_Chi'],
  ['social.handle.youtube',  '@TorahTai_Chi'],
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
