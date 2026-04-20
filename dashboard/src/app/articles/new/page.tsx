import Link from 'next/link';
import { ArticleForm } from '@/components/article-form';

export const metadata = {
  title: 'New Article',
};

export default function NewArticlePage() {
  return (
    <div className="stagger">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '28px',
        }}
      >
        <Link
          href="/articles"
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            textDecoration: 'none',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          ← Articles
        </Link>
      </div>

      <h1
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 400,
          fontSize: 'clamp(30px, 4vw, 48px)',
          lineHeight: 1.04,
          letterSpacing: '-0.022em',
          margin: '0 0 36px 0',
          color: 'var(--ink-900)',
          fontVariationSettings: '"opsz" 110, "SOFT" 30',
        }}
      >
        New article
        <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
      </h1>

      <ArticleForm />
    </div>
  );
}
