import { NextRequest, NextResponse } from 'next/server';
import { createArticle } from '@/lib/storyblok';
import { requireAuth } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const story = await createArticle({
      title: String(body.title ?? ''),
      subtitle: (body.subtitle as string) ?? null,
      slug: String(body.slug ?? ''),
      category: (body.category as string) ?? null,
      excerpt: (body.excerpt as string) ?? null,
      body_json: (body.body_json as object) ?? null,
      read_minutes: body.read_minutes != null ? Number(body.read_minutes) : null,
      published: Boolean(body.published),
      published_at: (body.published_at as string) ?? null,
      seo_title: (body.seo_title as string) ?? null,
      seo_description: (body.seo_description as string) ?? null,
      seo_og_image: (body.seo_og_image as string) ?? null,
    });

    // Return a shape compatible with what ArticleForm expects (needs .id)
    return NextResponse.json({ id: String(story.id), slug: story.slug }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create article';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
