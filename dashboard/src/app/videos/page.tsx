import { createClient } from '@/lib/supabase/server';
import { VideosDashboard, type VideoCard } from '@/components/videos-dashboard';
import { publicVideoUrl } from '@/lib/storage-url';

const IN_FLIGHT_STATUSES = new Set([
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
]);

// Maximum time a job can sit in any in-flight status before we treat
// it as abandoned and stop showing it on /videos. Beshalach had a
// plan-only row stuck at status='queued' from 2026-05-20 — Modal
// never picked up the trigger — and the videos page kept showing the
// card as "generating" 13 days later (Yonah 2026-06-02 report).
// 2h is generously above the longest legitimate pipeline run we've
// ever observed (clips_only ~10-13 min, regen agent ~15 min).
// Anything older is either dead or in such bad shape it shouldn't
// pretend otherwise on a status dashboard.
const STALE_IN_FLIGHT_MS = 2 * 60 * 60 * 1000;

function isFreshInFlight(status: string, triggeredAt: string): boolean {
  if (!IN_FLIGHT_STATUSES.has(status)) return false;
  return Date.now() - new Date(triggeredAt).getTime() < STALE_IN_FLIGHT_MS;
}

interface JobRow {
  id: string;
  kind: string | null;
  status: string;
  status_message: string | null;
  topic: string | null;
  triggered_at: string;
  parsha_id: string | null;
  parshiot: { name: string; slug: string } | { name: string; slug: string }[] | null;
  videos:
    | { id: string; thumb_path: string | null; published_to_website: boolean | null }[]
    | { id: string; thumb_path: string | null; published_to_website: boolean | null }
    | null;
}

async function getVideoCards(): Promise<VideoCard[]> {
  const supabase = await createClient();

  // Pull every job (parsha + topic). We'll collapse to at most one card
  // per parsha (latest job wins) and one card per topic job.
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, kind, status, status_message, topic, triggered_at, parsha_id, ' +
      'parshiot!jobs_parsha_id_fkey(name, slug), ' +
      'videos(id, thumb_path, published_to_website)'
    )
    .order('triggered_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  const rows = data as unknown as JobRow[];

  // The new-flow editor decomposes a parsha's work across multiple
  // job kinds (plan-only → clips-only → compose → optional clips-only
  // regens). Any of them belong on this parsha's card. The pre-cutover
  // filter (`kind === 'parsha'` only) was leaving every new-flow parsha
  // off the list entirely — Yonah 2026-06-01 reported seeing only the
  // 5 legacy `parsha`-kind videos even though many newer ones exist.
  const PARSHA_DRAFT_KINDS = new Set([
    'parsha', 'plan-only', 'clips-only', 'compose', null,
  ]);

  // Pre-pass: for each parsha_id, determine if ANY of its jobs has a
  // PUBLISHED video, and whether any job is currently in flight.
  // /videos should only surface parshiot that are either live on the
  // site (published) or have work actively in progress (Yonah
  // 2026-06-02). Unpublished done drafts belong in the per-parsha
  // editor (/videos/{slug}), not the catalog. Includes parshiot of
  // kind='holiday' on the parshiot table — those are pulled in the
  // same way (holidays publish via the same pipeline, just have a
  // different kind in the parshiot table).
  const parshaHasPublished = new Set<string>();
  const parshaHasInFlight = new Set<string>();
  for (const row of rows) {
    if (!row.parsha_id) continue;
    const v = Array.isArray(row.videos) ? row.videos[0] : row.videos;
    if (v?.published_to_website) parshaHasPublished.add(row.parsha_id);
    if (isFreshInFlight(row.status, row.triggered_at)) parshaHasInFlight.add(row.parsha_id);
  }

  const cards: VideoCard[] = [];
  const seenParshaIds = new Set<string>();

  for (const row of rows) {
    const kind = (row.kind ?? 'parsha').toLowerCase();
    const videoRel = row.videos;
    const video = Array.isArray(videoRel) ? videoRel[0] : videoRel;
    const parshaRel = row.parshiot;
    const parsha = Array.isArray(parshaRel) ? parshaRel[0] : parshaRel;

    const state: VideoCard['state'] =
      row.status === 'done' ? 'done'
      : row.status === 'failed' ? 'failed'
      : isFreshInFlight(row.status, row.triggered_at) ? 'in_flight'
      : 'other';

    if (row.parsha_id && PARSHA_DRAFT_KINDS.has(kind)) {
      if (seenParshaIds.has(row.parsha_id)) continue; // latest-per-parsha only
      // Qualifying gate: this parsha has at least one published video
      // OR has an in-flight job somewhere. Parshiot with only
      // unpublished drafts don't show — they're still reachable via
      // /parshiot or the per-parsha editor.
      const qualifies =
        parshaHasPublished.has(row.parsha_id) ||
        parshaHasInFlight.has(row.parsha_id);
      if (!qualifies) continue;
      seenParshaIds.add(row.parsha_id);
      cards.push({
        key: `parsha:${row.parsha_id}`,
        kind: 'parsha',
        title: parsha?.name ?? 'Parsha',
        href: parsha?.slug ? `/videos/${parsha.slug}` : `/jobs/${row.id}`,
        jobId: row.id,
        state,
        statusMessage: row.status_message ?? row.status,
        triggeredAt: row.triggered_at,
        thumbUrl: video?.thumb_path ? publicVideoUrl(video.thumb_path) : null,
      });
    } else if (kind === 'topic') {
      cards.push({
        key: `job:${row.id}`,
        kind: 'topic',
        title: (row.topic ?? 'Ad-hoc video').slice(0, 80),
        href: `/jobs/${row.id}`,
        jobId: row.id,
        state,
        statusMessage: row.status_message ?? row.status,
        triggeredAt: row.triggered_at,
        thumbUrl: video?.thumb_path ? publicVideoUrl(video.thumb_path) : null,
      });
    }
  }

  return cards;
}

export default async function VideosPage() {
  const cards = await getVideoCards();

  return (
    <div className="stagger">
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Videos<em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '16px',
            color: 'var(--ink-500)',
            margin: '0 0 36px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          What&apos;s generating, ready to post, and already out. Start a new one from{' '}
          <a href="/parshiot" style={{ color: 'var(--navy-700)' }}>Parshiot</a> or{' '}
          <a href="/compose" style={{ color: 'var(--navy-700)' }}>Compose</a>.
        </p>
      </div>

      <VideosDashboard cards={cards} />
    </div>
  );
}
