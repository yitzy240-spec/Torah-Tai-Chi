// Seed data helper for QA Tier 2 tests.
//
// SAFETY INVARIANT: every videos/posts row written here has qa_seed=true.
// wipeSeed() (called by global-teardown) deletes all such rows.
//
// Schema realities discovered in Step-1 inspection (see
// dashboard/supabase/migrations/0001_slice1_schema.sql and 0003_posts_table.sql):
//
//   videos:
//     - id uuid PK (auto)
//     - job_id uuid NOT NULL UNIQUE → FK jobs(id)
//     - mp4_path text NOT NULL
//     - duration_s numeric (nullable)
//     - thumb_path text (nullable; added at runtime, used by the app)
//     - qa_seed boolean NOT NULL default false
//
//     There is NO slug/title/status column on videos — those live on the
//     parent job. So a "completed" vs "processing" pair of video rows
//     actually means two videos whose parent jobs differ in status_message,
//     since videos only exist once the stitching stage writes the row.
//     A genuine "mid-run" state has no video row at all. We seed two
//     videos both whose jobs are in state 'done' (only states where a
//     video row naturally exists) and distinguish them by status_message
//     and script title so list views can render them differently.
//
//   posts:
//     - id uuid PK (auto)
//     - video_id uuid NOT NULL → FK videos(id) ON DELETE CASCADE
//     - platform text NOT NULL, CHECK IN ('tiktok','instagram','youtube','facebook')
//     - status text NOT NULL default 'pending', CHECK IN ('pending','scheduled','published','failed')
//     - caption text NOT NULL
//     - scheduled_at timestamptz (nullable)  ← NOTE: column is scheduled_at, not scheduled_for
//     - buffer_update_id text (nullable)
//     - published_at timestamptz (nullable)
//     - post_url text (nullable)
//     - qa_seed boolean NOT NULL default false
//
//   Cascading FK requirement:
//     videos.job_id → jobs(id)  (jobs.parsha_id → parshiot(id))
//     Neither jobs nor parshiot have qa_seed columns. We reuse an
//     existing real parsha (parshiot is a fixed reference list) and
//     create seed jobs. wipeSeed() deletes the parent jobs explicitly
//     after deleting their videos, keyed by a sentinel in error_message.
//
// This file is wired into global-setup.ts. It is only ever called under
// the controlled `npm run qa` flow, never from test specs directly.

import { serviceClient } from './auth';

const SEED_PREFIX = 'qa-test-';
const SEED_SENTINEL = 'QA_SEED_ROW'; // tags seed jobs via error_message column

export interface SeedHandles {
  videoCompletedId: string;
  videoProcessingId: string;
  postScheduledId: string;
}

export async function seedAll(): Promise<SeedHandles> {
  const sb = serviceClient();

  // Step 1: find an existing real parsha to satisfy jobs.parsha_id FK.
  // parshiot is a fixed reference list populated by dashboard/scripts/seed-parshiot.ts.
  const { data: parsha, error: parshaErr } = await sb
    .from('parshiot')
    .select('id')
    .order('order', { ascending: true })
    .limit(1)
    .single();
  if (parshaErr || !parsha) {
    throw new Error(
      `seed: no parshiot rows found (required for jobs.parsha_id FK): ${parshaErr?.message ?? 'empty'}`,
    );
  }

  // Step 2: insert two seed jobs. Tagged via error_message sentinel so wipeSeed
  // can delete them without orphaning the parent FK. status='done' because
  // videos only exist for completed pipelines (see Schema realities above).
  const { data: jobs, error: jErr } = await sb
    .from('jobs')
    .insert([
      {
        parsha_id: parsha.id,
        status: 'done',
        status_message: `${SEED_PREFIX}completed`,
        error_message: SEED_SENTINEL,
      },
      {
        parsha_id: parsha.id,
        status: 'done',
        status_message: `${SEED_PREFIX}processing`,
        error_message: SEED_SENTINEL,
      },
    ])
    .select('id');
  if (jErr) throw jErr;
  if (!jobs || jobs.length < 2) {
    throw new Error('seed: jobs insert returned unexpected rows');
  }

  // Step 3: insert the matching video rows. mp4_path is a synthetic path —
  // nothing attempts to open the file in Tier 2 list-rendering tests.
  const { data: videos, error: vErr } = await sb
    .from('videos')
    .insert([
      {
        job_id: jobs[0].id,
        mp4_path: `${SEED_PREFIX}completed/final.mp4`,
        qa_seed: true,
      },
      {
        job_id: jobs[1].id,
        mp4_path: `${SEED_PREFIX}processing/final.mp4`,
        qa_seed: true,
      },
    ])
    .select('id');
  if (vErr) throw vErr;
  if (!videos || videos.length < 2) {
    throw new Error('seed: videos insert returned unexpected rows');
  }

  // Step 4: insert a scheduled youtube post attached to the first seed video.
  const { data: posts, error: pErr } = await sb
    .from('posts')
    .insert([
      {
        video_id: videos[0].id,
        platform: 'youtube',
        status: 'scheduled',
        caption: 'QA TEST — scheduled post caption',
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
        qa_seed: true,
      },
    ])
    .select('id');
  if (pErr) throw pErr;
  if (!posts || posts.length < 1) {
    throw new Error('seed: posts insert returned unexpected rows');
  }

  return {
    videoCompletedId: videos[0].id,
    videoProcessingId: videos[1].id,
    postScheduledId: posts[0].id,
  };
}

export async function wipeSeed(): Promise<void> {
  const sb = serviceClient();

  // Capture seed job ids via the videos FK before we delete the videos,
  // since jobs has no qa_seed column of its own.
  const { data: seedVideos } = await sb
    .from('videos')
    .select('job_id')
    .eq('qa_seed', true);
  const seedJobIds = (seedVideos ?? [])
    .map((v) => v.job_id)
    .filter((id): id is string => typeof id === 'string');

  // Delete posts first. (FK posts.video_id → videos(id) is ON DELETE CASCADE,
  // so this is defensive — deleting the videos would cascade-drop them — but
  // being explicit avoids relying on cascade semantics.)
  await sb.from('posts').delete().eq('qa_seed', true);
  await sb.from('videos').delete().eq('qa_seed', true);

  // Finally, clean up the parent jobs we created. Double-filter: sentinel +
  // id list, so we never delete a real job even if someone else wrote the
  // sentinel string into error_message.
  if (seedJobIds.length > 0) {
    await sb
      .from('jobs')
      .delete()
      .eq('error_message', SEED_SENTINEL)
      .in('id', seedJobIds);
  }
}
