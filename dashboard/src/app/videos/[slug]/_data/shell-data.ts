// dashboard/src/app/videos/[slug]/_data/shell-data.ts
//
// Fetches the "shell" data that paints before the Suspense boundary:
//   1. parsha + scripts (slug → parsha.id)
//   2. jobs + derived (videos, posts, clips) — three inner queries in parallel
//
// Returns ShellData or null (caller should notFound() on null).

import { createClient } from '@/lib/supabase/server';
import { selectPageState } from '@/lib/page-state';
import type { DraftPhase, PageState } from '@/lib/page-state';
import type { PersistentLiveStrip } from '../_components/persistent-live-strip';

type ScriptRow = {
  id: string;
  option: string;
  title: string | null;
  draft_text: string | null;
};

type JobRow = {
  id: string;
  status: string;
  kind: string | null;
  script_id: string | null;
  triggered_at: string;
  completed_at: string | null;
  regen_of_job_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clip_plans: any;
};

export type ShellParsha = {
  id: string;
  name: string;
  book: string;
  slug: string;
  hebrew_name: string | null;
  scripts: ScriptRow[];
};

export type ShellData = {
  parsha: ShellParsha;
  state: PageState;
  videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }>;
  postsForState: Array<{ videoId: string; status: string; platform: string }>;
  jobsForState: Array<{
    id: string;
    status: string;
    kind: string | null;
    /** Surfaced so page-new can detect "user picked a different script"
     *  on a re-Generate and supersede the existing draft instead of
     *  silently showing the old plan. */
    scriptId: string | null;
    videoId: string | null;
    clipPlanId: string | null;
    /** Parent job for clips-only / compose / regen jobs. NULL on the
     *  plan-only root. Surfaced so page.tsx can resolve back to the
     *  plan-only ancestor when entering Phase 2 or Phase 3 from a
     *  later phase — without this, "Back to clips" from Phase 4 lands
     *  on the compose job, which has zero plan clips, and the page
     *  renders empty (2026-06-01 Yonah report). */
    regenOfJobId: string | null;
    completedAt: string | null;
    triggeredAt: string;
  }>;
  clipsByJobId: Record<string, Array<{ storagePath: string | null }>>;
  liveStripProps: React.ComponentProps<typeof PersistentLiveStrip> | null;
  phase: DraftPhase | null;
  statePhase: DraftPhase | null;
  showDraftView: boolean;
};

export async function fetchPageShellData(
  slug: string,
  continueParam: boolean,
  phaseParam: DraftPhase | null,
): Promise<ShellData | null> {
  const supabase = await createClient();

  // Step 1: parsha (no embeds — same defensive reasoning as the videos /
  // clip_plans fetches below: supabase embeds proved unreliable on this
  // schema, sometimes returning empty arrays even when rows exist).
  // Scripts fetched separately right after.
  const { data: parshaRow, error: parshaErr } = await supabase
    .from('parshiot')
    .select('id, name, book, slug, hebrew_name')
    .eq('slug', slug)
    .single();

  if (parshaErr || !parshaRow) return null;

  // Step 2: scripts + jobs in parallel — both depend only on parsha.id.
  // Previously serialized, wasting ~100-200ms per page render. Embeds
  // are still off (proved unreliable for videos / clip_plans on this
  // schema); we fan out below by job_id instead.
  const [scriptsResult, jobsResult] = await Promise.all([
    supabase
      .from('scripts')
      .select('id, option, title, draft_text')
      .eq('parsha_id', parshaRow.id as string)
      .order('option', { ascending: true }),
    supabase
      .from('jobs')
      .select('id, status, kind, script_id, triggered_at, completed_at, regen_of_job_id')
      .eq('parsha_id', parshaRow.id as string)
      .order('triggered_at', { ascending: false }),
  ]);

  const parsha: ShellParsha = {
    id: parshaRow.id as string,
    name: parshaRow.name as string,
    book: parshaRow.book as string,
    slug: parshaRow.slug as string,
    hebrew_name: (parshaRow.hebrew_name as string | null) ?? null,
    scripts: (scriptsResult.data ?? []) as ScriptRow[],
  };

  const jobsRaw = jobsResult.data;

  const jobs = (jobsRaw ?? []) as unknown as JobRow[];
  const allJobIds = jobs.map((j) => j.id);

  // Step 2b: fetch videos, clip_plans, posts, clips in parallel by job_id.
  const [videosResult, clipPlansResult, clipsResult] = await Promise.all([
    allJobIds.length > 0
      ? supabase.from('videos').select('id, job_id, published_to_website').in('job_id', allJobIds)
      : Promise.resolve({ data: [] }),
    allJobIds.length > 0
      ? supabase.from('clip_plans').select('id, job_id').in('job_id', allJobIds)
      : Promise.resolve({ data: [] }),
    allJobIds.length > 0
      ? supabase.from('clips').select('job_id, storage_path').in('job_id', allJobIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Build lookup maps so the flatten step is O(1) per job.
  const videoByJobId = new Map<string, { id: string; publishedToWebsite: boolean }>();
  for (const v of videosResult.data ?? []) {
    videoByJobId.set(v.job_id as string, {
      id: v.id as string,
      publishedToWebsite: !!(v.published_to_website as boolean | null),
    });
  }
  const clipPlanByJobId = new Map<string, string>();
  for (const cp of clipPlansResult.data ?? []) {
    clipPlanByJobId.set(cp.job_id as string, cp.id as string);
  }

  // Flatten jobs with the resolved video / clip_plan ids.
  const jobsForState = jobs.map((j) => {
    const video = videoByJobId.get(j.id);
    return {
      id: j.id,
      status: j.status,
      kind: j.kind,
      scriptId: j.script_id,
      videoId: video?.id ?? null,
      clipPlanId: clipPlanByJobId.get(j.id) ?? null,
      regenOfJobId: j.regen_of_job_id,
      completedAt: j.completed_at,
      triggeredAt: j.triggered_at,
    };
  });

  const videoIds = jobsForState
    .map((jj) => jj.videoId)
    .filter((id): id is string => id !== null);

  // Step 2c: posts — only needed once we know which video ids exist.
  const postsResult = videoIds.length > 0
    ? await supabase.from('posts').select('video_id, status, platform').in('video_id', videoIds)
    : { data: [] };

  const videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }> = (
    videosResult.data ?? []
  ).map((v) => ({
    id: v.id as string,
    jobId: v.job_id as string,
    publishedToWebsite: !!(v.published_to_website as boolean | null),
  }));

  const postsForState: Array<{ videoId: string; status: string; platform: string }> = (
    postsResult.data ?? []
  ).map((p) => ({
    videoId: p.video_id as string,
    status: p.status as string,
    platform: p.platform as string,
  }));

  const clipsByJobId: Record<string, Array<{ storagePath: string | null }>> = {};
  for (const c of clipsResult.data ?? []) {
    const jid = c.job_id as string;
    if (!clipsByJobId[jid]) clipsByJobId[jid] = [];
    clipsByJobId[jid].push({ storagePath: c.storage_path as string | null });
  }

  // Compute page state (pure)
  const state = selectPageState({
    jobs: jobsForState,
    videos: videosForState,
    posts: postsForState,
    clipsByJobId,
    hasScripts: (parsha.scripts ?? []).some(
      (s) => (s.draft_text ?? '').trim().length > 0,
    ),
  });

  // Live-strip props (live-and-draft state only)
  let liveStripProps: React.ComponentProps<typeof PersistentLiveStrip> | null = null;
  if (state.kind === 'live-and-draft') {
    const liveVideo = videosForState.find((v) => v.id === state.liveVideoId);
    const livePosts = postsForState
      .filter((p) => p.videoId === state.liveVideoId && p.status === 'published')
      .map((p) => ({ platform: p.platform, url: null }));
    const liveIdx = videosForState.findIndex((v) => v.id === state.liveVideoId) + 1;
    liveStripProps = {
      liveVersionLabel: `v${liveIdx}`,
      publishedToWebsite: liveVideo?.publishedToWebsite ?? false,
      websiteUrl: `https://torahtaichi.com/${slug}`,
      livePosts,
    };
  }

  const statePhase =
    state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
      ? state.phase
      : null;
  const phase = phaseParam ?? statePhase;

  const showDraftView =
    state.kind === 'draft-in-progress' ||
    (state.kind === 'live-and-draft' && (continueParam || phaseParam !== null));

  return {
    parsha,
    state,
    videosForState,
    postsForState,
    jobsForState,
    clipsByJobId,
    liveStripProps,
    phase,
    statePhase,
    showDraftView,
  };
}
