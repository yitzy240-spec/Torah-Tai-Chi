import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleForm } from '@/components/article-form';
import { mapiGetStory } from '@/lib/storyblok-server';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const story = await mapiGetStory(Number(id));
    const title = story?.content?.title;
    return { title: title ? `Edit: ${title}` : 'Edit Article' };
  } catch {
    return { title: 'Edit Article' };
  }
}

export default async function EditArticlePage({ params }: Props) {
  const { id } = await params;
  const storyId = Number(id);

  let story: Awaited<ReturnType<typeof mapiGetStory>>;
  try {
    story = await mapiGetStory(storyId);
  } catch {
    notFound();
  }

  if (!story || story.content?.component !== 'article') {
    notFound();
  }

  // content is Record<string, unknown> — cast to known shape
  const c = story.content as {
    component?: string;
    title?: string;
    subtitle?: string;
    category?: string;
    excerpt?: string;
    body?: object;
    read_minutes?: number;
    published_at?: string;
  };

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
          &larr; Articles
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
          id: String(story.id),
          title: c.title ?? '',
          subtitle: c.subtitle ?? '',
          slug: story.slug ?? '',
          category: (c.category as 'Essay' | 'Teaching' | 'Reflection' | '') ?? '',
          excerpt: c.excerpt ?? '',
          read_minutes: c.read_minutes ?? '',
          body_json: (c.body as object) ?? null,
          body_html: '',
          published: story.published ?? false,
        }}
      />
    </div>
  );
}
