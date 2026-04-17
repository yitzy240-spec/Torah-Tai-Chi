import { createClient } from '@/lib/supabase/server';
import { SiteContentEditor } from './site-content-editor';

export const metadata = {
  title: 'Site Content',
};

export default async function SiteContentPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('site_content')
    .select('*')
    .order('key');

  if (error) {
    return (
      <div style={{ maxWidth: '720px' }}>
        <p style={{ color: 'var(--tassel)', fontFamily: 'var(--ff-display)', fontStyle: 'italic' }}>
          Could not load site content: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '720px' }} className="stagger">
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
          Site content
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '15px',
            color: 'var(--ink-500)',
            margin: '0 0 44px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          The text Yonah can edit on the public site.
        </p>
      </div>

      <SiteContentEditor initialRows={rows ?? []} />
    </div>
  );
}
