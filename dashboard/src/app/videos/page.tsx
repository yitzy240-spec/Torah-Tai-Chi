import { createClient } from '@/lib/supabase/server';
import { VideosFilter } from '@/components/videos-filter';
import { publicVideoUrl } from '@/lib/storage-url';

interface Script {
  option: string;
  draft_text: string | null;
}

interface VideoWithJob {
  thumb_path: string | null;
  jobs: { parsha_id: string } | { parsha_id: string }[] | null;
}

interface Parsha {
  id: string;
  order: number;
  name: string;
  book: string;
  slug: string;
  hebrew_name: string | null;
  scripts: Script[];
  thumbUrl?: string | null;
}

async function getParshiot(): Promise<Parsha[]> {
  const supabase = await createClient();
  const [parshaResult, videoResult] = await Promise.all([
    supabase
      .from('parshiot')
      .select('id, order, name, book, slug, hebrew_name, scripts(option, draft_text)')
      .order('order'),
    supabase
      .from('videos')
      .select('thumb_path, jobs(parsha_id)'),
  ]);

  if (parshaResult.error || !parshaResult.data) return [];

  const thumbMap = new Map<string, string | null>();
  for (const v of (videoResult.data ?? []) as VideoWithJob[]) {
    if (!v.thumb_path || !v.jobs) continue;
    const parshaId = Array.isArray(v.jobs) ? v.jobs[0]?.parsha_id : v.jobs.parsha_id;
    if (parshaId) thumbMap.set(parshaId, v.thumb_path);
  }

  return (parshaResult.data as Parsha[]).map((p) => {
    const tp = thumbMap.get(p.id) ?? null;
    return {
      ...p,
      thumbUrl: tp ? publicVideoUrl(tp) : null,
    };
  });
}

export default async function VideosPage() {
  const parshiot = await getParshiot();

  const withScript = parshiot.filter((p) =>
    p.scripts?.some((s) => s.option === 'A-tight'),
  );

  // Pass thumbUrl into each parsha for Feature B
  const withThumbs = withScript.map((p) => ({
    ...p,
    thumbUrl: p.thumbUrl ?? null,
  }));

  return (
    <div className="stagger">
      {/* Page header */}
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
          All <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>52</em> parshiot.
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
          Every weekly portion, from Bereishit to V&apos;Zot HaBerachah.
        </p>
      </div>

      {/* Filter + Grid — client component */}
      <VideosFilter parshiot={withThumbs} />
    </div>
  );
}
