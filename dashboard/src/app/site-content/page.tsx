import { listSiteText } from '@/lib/storyblok';
import { SiteContentEditor } from './site-content-editor';

export const metadata = {
  title: 'Site Content',
};

export default async function SiteContentPage() {
  let rows: { id: string; key: string; value: string; description: string | null; updated_at: string | null }[] = [];
  let errorMsg: string | null = null;

  try {
    const stories = await listSiteText();
    rows = stories.map((s) => ({
      id: String(s.id),
      key: s.content.key,
      value: s.content.value ?? '',
      description: s.content.description ?? null,
      updated_at: s.updated_at ?? null,
    }));
    rows.sort((a, b) => a.key.localeCompare(b.key));
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : 'Unknown error';
  }

  if (errorMsg) {
    return (
      <div style={{ maxWidth: '720px' }}>
        <p style={{ color: 'var(--tassel)', fontFamily: 'var(--ff-display)', fontStyle: 'italic' }}>
          Could not load site content: {errorMsg}
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

      <SiteContentEditor initialRows={rows} />
    </div>
  );
}
