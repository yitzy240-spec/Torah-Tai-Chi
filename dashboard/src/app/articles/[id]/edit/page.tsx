import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArticleForm } from '@/components/article-form';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('articles')
    .select('title')
    .eq('id', id)
    .single();
  return { title: data?.title ? `Edit: ${data.title}` : 'Edit Article' };
}

export default async function EditArticlePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: article, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !article) {
    notFound();
  }

  return (
    <div className="stagger">
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
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
        Edit article
        <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
      </h1>

      <ArticleForm
        initial={{
          id: article.id,
          title: article.title ?? '',
          subtitle: article.subtitle ?? '',
          slug: article.slug ?? '',
          category: article.category ?? '',
          excerpt: article.excerpt ?? '',
          read_minutes: article.read_minutes ?? '',
          body_json: article.body_json ?? null,
          body_html: article.body_html ?? '',
          published: article.published ?? false,
        }}
      />
    </div>
  );
}
