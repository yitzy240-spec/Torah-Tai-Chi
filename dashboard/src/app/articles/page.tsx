import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'Articles',
};

function StatusDot({ published }: { published: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: published ? 'var(--jade)' : 'var(--ink-300)',
        flexShrink: 0,
        marginRight: '6px',
      }}
      title={published ? 'Published' : 'Draft'}
    />
  );
}

function formatDate(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function ArticlesPage() {
  const supabase = await createClient();
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, slug, title, category, published, published_at, updated_at, excerpt')
    .order('updated_at', { ascending: false });

  return (
    <div style={{ maxWidth: '900px' }} className="stagger">
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: '32px',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: 0,
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Articles
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
        </h1>
        <Link
          href="/articles/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '11px 22px',
            minHeight: '44px',
            borderRadius: '999px',
            border: 'none',
            background: 'var(--navy-800)',
            color: 'var(--linen-50)',
            textDecoration: 'none',
            transition: 'all var(--trans)',
            flexShrink: 0,
          }}
        >
          + New article
        </Link>
      </div>

      {error && (
        <p style={{ color: 'var(--tassel)', fontFamily: 'var(--ff-display)', fontStyle: 'italic' }}>
          Could not load articles: {error.message}
        </p>
      )}

      {(!articles || articles.length === 0) && !error && (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            border: '1px dashed var(--ink-200)',
            borderRadius: 'var(--r-lg)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            color: 'var(--ink-400)',
          }}
        >
          No articles yet. Write your first one.
        </div>
      )}

      {articles && articles.length > 0 && (
        <div
          style={{
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 120px 130px 88px',
              padding: '10px 20px',
              borderBottom: '1px solid var(--ink-100)',
              background: 'var(--linen-100)',
              gap: '12px',
            }}
          >
            {['Title', 'Category', 'Status', 'Updated', 'Actions'].map((h) => (
              <span
                key={h}
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 600,
                  fontSize: '10.5px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-500)',
                }}
              >
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {articles.map((article, i) => (
            <div
              key={article.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 120px 130px 88px',
                padding: '14px 20px',
                gap: '12px',
                borderBottom: i < articles.length - 1 ? '1px solid var(--ink-100)' : 'none',
                alignItems: 'center',
                background: 'var(--linen-50)',
                transition: 'background var(--trans)',
              }}
            >
              {/* Title */}
              <div>
                <Link
                  href={`/articles/${article.id}/edit`}
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontWeight: 500,
                    fontSize: '15px',
                    color: 'var(--ink-900)',
                    textDecoration: 'none',
                    fontVariationSettings: '"opsz" 18, "SOFT" 30',
                  }}
                >
                  {article.title || <em style={{ color: 'var(--ink-400)' }}>Untitled</em>}
                </Link>
                {article.excerpt && (
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12px',
                      color: 'var(--ink-400)',
                      marginTop: '2px',
                      fontVariationSettings: '"opsz" 12, "SOFT" 50',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {article.excerpt}
                  </div>
                )}
              </div>

              {/* Category */}
              <span
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '12.5px',
                  color: 'var(--ink-500)',
                  fontVariationSettings: '"opsz" 13, "SOFT" 40',
                }}
              >
                {article.category ?? '—'}
              </span>

              {/* Status */}
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '12.5px',
                  color: article.published ? 'var(--jade)' : 'var(--ink-400)',
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontVariationSettings: '"opsz" 13, "SOFT" 40',
                }}
              >
                <StatusDot published={article.published ?? false} />
                {article.published ? 'Published' : 'Draft'}
              </span>

              {/* Updated */}
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--ink-400)',
                  fontFamily: 'var(--ff-body)',
                }}
              >
                {formatDate(article.updated_at)}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Link
                  href={`/articles/${article.id}/edit`}
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--navy-700)',
                    textDecoration: 'none',
                    padding: '6px 10px',
                    minHeight: '32px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--navy-100)',
                    background: 'var(--navy-wash)',
                    transition: 'all var(--trans)',
                  }}
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
