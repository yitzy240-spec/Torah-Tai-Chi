import { createClient } from '@/lib/supabase/server';
import { VideosFilter } from '@/components/videos-filter';
import { publicVideoUrl } from '@/lib/storage-url';

interface Script {
  option: string;
  draft_text: string | null;
}

interface VideoWithJob {
  thumb_path: string | null;
  jobs:
    | { parsha_id: string | null; partner_parsha_id: string | null }
    | { parsha_id: string | null; partner_parsha_id: string | null }[]
    | null;
}

interface Parsha {
  id: string;
  order: number | null;
  name: string;
  book: string;
  slug: string;
  hebrew_name: string | null;
  kind: 'parsha' | 'holiday';
  scripts: Script[];
  thumbUrl?: string | null;
}

async function getParshiot(): Promise<Parsha[]> {
  const supabase = await createClient();
  const [parshaResult, videoResult] = await Promise.all([
    supabase
      .from('parshiot')
      .select('id, order, name, book, slug, hebrew_name, kind, scripts(option, draft_text)')
      .order('kind')
      .order('order', { nullsFirst: false })
      .order('name'),
    supabase
      .from('videos')
      .select('thumb_path, jobs(parsha_id, partner_parsha_id)'),
  ]);

  if (parshaResult.error || !parshaResult.data) return [];

  // Combined-parsha weeks: a single job carries both `parsha_id` (primary)
  // and `partner_parsha_id`. Map the same thumb to BOTH rows of the 54-grid
  // so neither parsha is left looking unconvered.
  const thumbMap = new Map<string, string | null>();
  for (const v of (videoResult.data ?? []) as VideoWithJob[]) {
    if (!v.thumb_path || !v.jobs) continue;
    const job = Array.isArray(v.jobs) ? v.jobs[0] : v.jobs;
    if (job?.parsha_id) thumbMap.set(job.parsha_id, v.thumb_path);
    if (job?.partner_parsha_id) thumbMap.set(job.partner_parsha_id, v.thumb_path);
  }

  return (parshaResult.data as Parsha[]).map((p) => {
    const tp = thumbMap.get(p.id) ?? null;
    return {
      ...p,
      thumbUrl: tp ? publicVideoUrl(tp) : null,
    };
  });
}

export default async function ParshiotPage() {
  const parshiot = await getParshiot();

  // Show every parsha — this is the full-year reference library.
  const withThumbs = parshiot.map((p) => ({
    ...p,
    thumbUrl: p.thumbUrl ?? null,
  }));

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
          The full <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>library</em>.
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
          Every weekly portion plus the major holidays. Click into one to review or start a video.
        </p>
      </div>

      <VideosFilter parshiot={withThumbs} />
    </div>
  );
}
