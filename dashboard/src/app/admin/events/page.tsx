import { createServiceClient } from '@/lib/supabase/service';
import { EventsViewer, type ViewerEvent } from './events-viewer';

export const dynamic = 'force-dynamic';

interface EventRow {
  id: string;
  created_at: string;
  actor: string;
  level: string;
  event: string;
  subject_type: string | null;
  subject_id: string | null;
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean | null;
}

/**
 * Diagnostics — last 200 execution_events. Service-role read so we see
 * everything regardless of RLS. Video subjects get their slug resolved
 * in one follow-up query so "view source" links land on /videos/<slug>.
 */
export default async function EventsPage() {
  const svc = createServiceClient();

  const { data: rowsData, error } = await svc
    .from('execution_events')
    .select('id, created_at, actor, level, event, subject_type, subject_id, message, details, resolved')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: EventRow[] = (rowsData ?? []) as EventRow[];

  // Resolve slugs for subject_type='video' in a single query so the
  // viewer can link straight to /videos/<slug>. Missing rows fall back
  // to the raw id in the UI.
  const videoIds = Array.from(
    new Set(
      rows
        .filter((r) => r.subject_type === 'video' && r.subject_id)
        .map((r) => r.subject_id as string),
    ),
  );

  const videoSlugMap: Record<string, string> = {};
  if (videoIds.length > 0) {
    const { data: vids } = await svc
      .from('videos')
      .select('id, jobs(parsha_id, parshiot!jobs_parsha_id_fkey(slug))')
      .in('id', videoIds);
    type VideoJoin = {
      id: string;
      jobs:
        | { parshiot: { slug: string } | { slug: string }[] | null }
        | { parshiot: { slug: string } | { slug: string }[] | null }[]
        | null;
    };
    for (const v of (vids ?? []) as VideoJoin[]) {
      const job = Array.isArray(v.jobs) ? v.jobs[0] : v.jobs;
      const p = job?.parshiot;
      const slug = Array.isArray(p) ? p[0]?.slug : p?.slug;
      if (slug) videoSlugMap[v.id] = slug;
    }
  }

  const events: ViewerEvent[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    actor: r.actor,
    level: r.level,
    event: r.event,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    message: r.message,
    details: r.details,
    resolved: !!r.resolved,
    subjectHref:
      r.subject_type === 'video' && r.subject_id && videoSlugMap[r.subject_id]
        ? `/videos/${videoSlugMap[r.subject_id]}`
        : null,
  }));

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '28px',
            letterSpacing: '-0.015em',
            margin: '0 0 6px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 48, "SOFT" 30',
          }}
        >
          Diagnostics
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            margin: 0,
          }}
        >
          {error
            ? `Failed to load events: ${error.message}`
            : `Last ${events.length} execution events, newest first.`}
        </p>
      </div>

      <EventsViewer events={events} />
    </div>
  );
}
