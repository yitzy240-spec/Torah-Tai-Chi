import { createClient } from '@/lib/supabase/server';
import { VideosFilter } from '@/components/videos-filter';

const SUPABASE_STORAGE_URL =
  'https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/videos/';

interface Script {
  option: string;
  draft_text: string | null;
}

interface Video {
  parsha_id: string;
  thumb_path: string | null;
}

interface Parsha {
  id: string;
  order: number;
  name: string;
  book: string;
  slug: string;
  name_hebrew: string | null;
  scripts: Script[];
  thumbUrl?: string | null;
}

async function getParshiot(): Promise<{ parshiot: Parsha[]; debug: string }> {
  const supabase = await createClient();
  const [parshaResult, videoResult] = await Promise.all([
    supabase
      .from('parshiot')
      .select('id, order, name, book, slug, name_hebrew, scripts(option, draft_text)')
      .order('order'),
    supabase
      .from('videos')
      .select('parsha_id, thumb_path'),
  ]);

  const debug = JSON.stringify({
    parshaErr: parshaResult.error?.message ?? null,
    parshaCount: parshaResult.data?.length ?? 0,
    firstParshaScripts: parshaResult.data?.[0]?.scripts?.length ?? 0,
    firstOptions: (parshaResult.data?.[0] as Parsha | undefined)?.scripts?.map((s) => s.option) ?? [],
    videoErr: videoResult.error?.message ?? null,
    videoCount: videoResult.data?.length ?? 0,
  });

  if (parshaResult.error || !parshaResult.data) return { parshiot: [], debug };

  const thumbMap = new Map<string, string | null>();
  for (const v of (videoResult.data ?? []) as Video[]) {
    if (v.thumb_path) thumbMap.set(v.parsha_id, v.thumb_path);
  }

  const parshiot = (parshaResult.data as Parsha[]).map((p) => {
    const tp = thumbMap.get(p.id) ?? null;
    return {
      ...p,
      thumbUrl: tp ? `${SUPABASE_STORAGE_URL}${tp}` : null,
    };
  });
  return { parshiot, debug };
}

export default async function VideosPage() {
  const { parshiot, debug } = await getParshiot();

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

      {/* DEBUG — remove after root-cause */}
      <pre style={{ background: '#fff3cd', padding: '8px', fontSize: '11px', marginBottom: '16px', whiteSpace: 'pre-wrap' }}>{debug} | withScript={withScript.length}</pre>

      {/* Filter + Grid — client component */}
      <VideosFilter parshiot={withThumbs} />
    </div>
  );
}
