// Probe Buffer's rate-limit headers with ONE read-only GraphQL call.
// Usage: node tools/probe-buffer-remaining.mjs   (reads BUFFER_ACCESS_TOKEN from root .env)
// Costs 1 of the 100/day budget per run. NEVER calls createPost.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(resolve(root, '.env'), 'utf8');
const token = env.match(/^BUFFER_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('BUFFER_ACCESS_TOKEN not found in .env');

const res = await fetch('https://api.buffer.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ viewer { id } }' }),
});
const reset = res.headers.get('x-ratelimit-reset');
console.log(JSON.stringify({
  status: res.status,
  limit: res.headers.get('x-ratelimit-limit'),
  remaining: res.headers.get('x-ratelimit-remaining'),
  reset,
  resetIso: reset ? new Date(Number(reset) * 1000).toISOString() : null,
}, null, 2));
