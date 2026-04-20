import Link from 'next/link';
import { SeoDefaultsForm } from './seo-defaults-form';
import { getSeoDefaults } from '@/lib/storyblok';

export const metadata = { title: 'SEO Defaults' };

export default async function SeoDefaultsPage() {
  let defaults = null;
  try {
    defaults = await getSeoDefaults();
  } catch {
    // will render with empty form
  }

  const c = defaults?.content ?? ({} as import('@/lib/storyblok').SbSeoDefaultsContent);

  const H2_STYLE: React.CSSProperties = {
    fontFamily: 'var(--ff-display)',
    fontWeight: 500,
    fontSize: '20px',
    letterSpacing: '-0.015em',
    margin: '0 0 6px 0',
    color: 'var(--ink-900)',
    fontVariationSettings: '"opsz" 36, "SOFT" 30',
  };

  const DESC_STYLE: React.CSSProperties = {
    fontFamily: 'var(--ff-display)',
    fontStyle: 'italic',
    fontSize: '14px',
    color: 'var(--ink-500)',
    margin: '0 0 20px 0',
    fontVariationSettings: '"opsz" 14, "SOFT" 50',
  };

  return (
    <div className="stagger" style={{ maxWidth: '680px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
        <Link
          href="/settings"
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            textDecoration: 'none',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          &larr; Settings
        </Link>
      </div>

      <h1
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 400,
          fontSize: 'clamp(30px, 4vw, 48px)',
          lineHeight: 1.04,
          letterSpacing: '-0.022em',
          margin: '0 0 8px 0',
          color: 'var(--ink-900)',
          fontVariationSettings: '"opsz" 110, "SOFT" 30',
        }}
      >
        SEO defaults
        <em
          style={{
            fontStyle: 'italic',
            color: 'var(--ink-500)',
            fontVariationSettings: '"opsz" 110, "SOFT" 60',
          }}
        >
          .
        </em>
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
        Site-wide fallbacks used when individual pages have no SEO overrides set.
      </p>

      <section
        style={{
          marginBottom: '40px',
          paddingBottom: '36px',
          borderBottom: '1px solid var(--ink-100)',
        }}
      >
        <h2 style={H2_STYLE}>Default title &amp; description</h2>
        <p style={DESC_STYLE}>
          Shown in search results when a page has no custom title or description.
        </p>

        <SeoDefaultsForm
          initial={{
            site_default_title: c.site_default_title ?? '',
            site_default_description: c.site_default_description ?? '',
            site_default_og_image: c.site_default_og_image ?? '',
            twitter_handle: c.twitter_handle ?? '',
          }}
        />
      </section>
    </div>
  );
}
