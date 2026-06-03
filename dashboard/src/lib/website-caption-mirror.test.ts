// dashboard/src/lib/website-caption-mirror.test.ts
// Run: node --test --experimental-strip-types src/lib/website-caption-mirror.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorInstagramCaptionToWebsite } from './website-caption-mirror.ts';

// Minimal Supabase mock: enough surface to satisfy the helper's chain.
// We capture every operation in a `calls` array so tests can assert the
// exact sequence (and the WHERE clause / payload for the final UPDATE).
// Typed loosely on purpose — the @supabase/supabase-js builder is a
// chained generic that's painful to satisfy structurally, and the
// helper's actual contract is enforced by the production type sig.
interface CallRecord {
  op: 'select' | 'update';
  table: string;
  cols?: string;
  values?: Record<string, unknown>;
  eq?: [string, unknown];
  inFilter?: [string, unknown[]];
}

interface MockResponse {
  data: unknown;
  error: { message: string } | null;
}

function makeSupabase(responses: MockResponse[], calls: CallRecord[]) {
  let nextResponse = 0;
  const consume = () => {
    if (nextResponse >= responses.length) {
      throw new Error(`mock ran out of responses at call #${nextResponse + 1}`);
    }
    return responses[nextResponse++];
  };

  return {
    from(table: string) {
      const pending: CallRecord = { op: 'select', table };
      const chain = {
        select(cols: string) {
          pending.op = 'select';
          pending.cols = cols;
          return chain;
        },
        update(values: Record<string, unknown>) {
          pending.op = 'update';
          pending.values = values;
          return chain;
        },
        eq(col: string, val: unknown) {
          pending.eq = [col, val];
          return chain;
        },
        in(col: string, vals: unknown[]) {
          pending.inFilter = [col, vals];
          // .in() is terminal for UPDATE in our helper — flush + return resp.
          if (pending.op === 'update') {
            calls.push({ ...pending });
            return Promise.resolve(consume());
          }
          return chain;
        },
        maybeSingle() {
          calls.push({ ...pending });
          return Promise.resolve(consume());
        },
        // PromiseLike so `await chain` after .eq() resolves (used by the
        // plain select-eq-no-maybeSingle list-parsha-jobs path).
        then(onFulfilled: (v: MockResponse) => unknown, onRejected?: (e: unknown) => unknown) {
          calls.push({ ...pending });
          return Promise.resolve(consume()).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

test('happy path: writes website_caption to every parsha job\'s videos row', async () => {
  const calls: CallRecord[] = [];
  // 1. jobs.select(parsha_id).eq(id, JOB_A).maybeSingle() -> {parsha_id: PARSHA_1}
  // 2. jobs.select(id).eq(parsha_id, PARSHA_1) -> [{id: JOB_A}, {id: JOB_B}, {id: JOB_C}]
  // 3. videos.update(...).in(job_id, [JOB_A, JOB_B, JOB_C]) -> ok
  const sb = makeSupabase(
    [
      { data: { parsha_id: 'PARSHA_1' }, error: null },
      { data: [{ id: 'JOB_A' }, { id: 'JOB_B' }, { id: 'JOB_C' }], error: null },
      { data: null, error: null },
    ],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'JOB_A', 'new caption');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].op, 'select');
  assert.equal(calls[0].table, 'jobs');
  assert.deepEqual(calls[0].eq, ['id', 'JOB_A']);
  assert.equal(calls[1].op, 'select');
  assert.deepEqual(calls[1].eq, ['parsha_id', 'PARSHA_1']);
  assert.equal(calls[2].op, 'update');
  assert.equal(calls[2].table, 'videos');
  assert.deepEqual(calls[2].values, { website_caption: 'new caption' });
  assert.deepEqual(calls[2].inFilter, ['job_id', ['JOB_A', 'JOB_B', 'JOB_C']]);
});

test('topic job (no parsha_id): no-op, returns ok', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [{ data: { parsha_id: null }, error: null }],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'TOPIC_JOB', 'irrelevant');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1, 'should bail after the first jobs lookup');
});

test('job not found: no-op, returns ok', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [{ data: null, error: null }],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'GHOST', 'whatever');
  assert.deepEqual(result, { ok: true });
});

test('parsha has zero sibling jobs (legitimately empty): no-op, returns ok', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [
      { data: { parsha_id: 'PARSHA_2' }, error: null },
      { data: [], error: null },
    ],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'JOB_X', 'text');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2, 'should NOT issue the UPDATE when allJobIds is empty');
});

test('job lookup error bubbles up as ok:false', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [{ data: null, error: { message: 'connection reset' } }],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'JOB_X', 'text');
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /lookup job/);
});

test('videos update error bubbles up as ok:false', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [
      { data: { parsha_id: 'PARSHA_3' }, error: null },
      { data: [{ id: 'JOB_Y' }], error: null },
      { data: null, error: { message: 'permission denied for table videos' } },
    ],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'JOB_Y', 'text');
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /update videos/);
});

test('empty string caption: still mirrors (operator may intentionally clear copy)', async () => {
  const calls: CallRecord[] = [];
  const sb = makeSupabase(
    [
      { data: { parsha_id: 'PARSHA_4' }, error: null },
      { data: [{ id: 'JOB_Z' }], error: null },
      { data: null, error: null },
    ],
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const result = await mirrorInstagramCaptionToWebsite(sb, 'JOB_Z', '');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[2].values, { website_caption: '' });
});
