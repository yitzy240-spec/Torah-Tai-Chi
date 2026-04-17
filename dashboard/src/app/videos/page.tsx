import { createClient } from '@/lib/supabase/server';
import { VideosFilter } from '@/components/videos-filter';

interface Script {
  option: string;
  draft_text: string | null;
}

interface Parsha {
  id: string;
  order: number;
  name: string;
  book: string;
  slug: string;
  name_hebrew: string | null;
  scripts: Script[];
}

async function getParshiot(): Promise<Parsha[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, name_hebrew, scripts(option, draft_text)')
    .order('order');

  if (error || !data) return [];
  return data as Parsha[];
}

export default async function VideosPage() {
  const parshiot = await getParshiot();

  // Only show parshiot that have an a-tight script
  const withScript = parshiot.filter((p) =>
    p.scripts?.some((s) => s.option === 'a-tight'),
  );

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
      <VideosFilter parshiot={withScript} />
    </div>
  );
}
