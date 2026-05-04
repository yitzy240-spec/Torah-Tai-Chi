// One-off diagnostic script to investigate recent regen jobs.
//
// Pulls the most recent jobs (last 24h), shows the regen tree
// (parent → regens), and dumps clip-level data for clip index 2 so we
// can see what voiceover / visual_prompt / motion_ref Seedance saw vs.
// what the parent had.
//
// Usage from repo root:
//   set -a && . ./.env && set +a && node tools/inspect_recent_regens.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://jswdfthmegjbhnwbgeca.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY);

const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const { data: jobs, error } = await sb
  .from('jobs')
  .select(
    'id, parsha_id, status, status_message, error_message, ' +
      'kind, regen_of_job_id, feedback_clip_index, motion_ref_slug, ' +
      'resolution, model_tier, triggered_at, completed_at, ' +
      'parshiot!jobs_parsha_id_fkey(name, slug)',
  )
  .gte('triggered_at', since)
  .order('triggered_at', { ascending: false });

if (error) {
  console.error('jobs query error:', error.message);
  process.exit(1);
}

console.log(`\n=== Recent jobs (last 24h, ${jobs.length} total) ===\n`);
for (const j of jobs) {
  const parsha = Array.isArray(j.parshiot) ? j.parshiot[0] : j.parshiot;
  const lineage = j.regen_of_job_id ? `regen_of=${j.regen_of_job_id.slice(0, 8)}` : 'parent';
  const fci = j.feedback_clip_index !== null ? ` fci=${j.feedback_clip_index}` : '';
  const motion = j.motion_ref_slug ? ` motion=${j.motion_ref_slug}` : '';
  console.log(
    `${j.triggered_at}  ${j.id.slice(0, 8)}  ${parsha?.name ?? '(no parsha)'}  ` +
      `${j.status}  ${j.kind}  ${lineage}${fci}${motion}  ${j.resolution ?? ''} ${j.model_tier ?? ''}`,
  );
  if (j.error_message) console.log(`  └─ error: ${j.error_message.slice(0, 200)}`);
}

if (jobs.length === 0) {
  console.log('No jobs in last 24h.');
  process.exit(0);
}

// For each parent job that has any clips, dump clip 2's data.
const parentJobIds = new Set();
for (const j of jobs) {
  parentJobIds.add(j.id);
  if (j.regen_of_job_id) parentJobIds.add(j.regen_of_job_id);
}

console.log('\n=== Clip index 2 across these jobs ===\n');
const { data: clip2s } = await sb
  .from('clips')
  .select(
    'id, job_id, index, voiceover, visual_prompt, motion_ref_slug, ' +
      'motion_ref_url, storage_path, status, created_at',
  )
  .in('job_id', [...parentJobIds])
  .eq('index', 2)
  .order('created_at', { ascending: true });

for (const c of clip2s ?? []) {
  console.log(
    `${c.created_at}  ${c.id.slice(0, 8)}  job=${c.job_id.slice(0, 8)}  ${c.status}` +
      `  motion_ref=${c.motion_ref_slug ?? 'none'}  storage=${c.storage_path ? 'yes' : 'NO'}`,
  );
  console.log(`  voiceover (${c.voiceover?.length ?? 0} ch): ${(c.voiceover ?? '').slice(0, 240)}`);
  console.log(
    `  visual_prompt (${c.visual_prompt?.length ?? 0} ch): ${(c.visual_prompt ?? '').slice(0, 240).replace(/\n/g, ' ')}`,
  );
  console.log(`  motion_ref_url: ${c.motion_ref_url ?? 'none'}`);
  console.log('');
}
