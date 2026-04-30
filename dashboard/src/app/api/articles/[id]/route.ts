import { NextRequest, NextResponse } from 'next/server';
import { updateArticle, deleteArticle } from '@/lib/storyblok';
import { requireAuth } from '@/lib/api-auth';
import { revalidateWebsite } from '@/lib/revalidate-website';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  const { id } = await ctx.params;
  const storyId = Number(id);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const allowed = [
    'title', 'subtitle', 'slug', 'category', 'excerpt',
    'read_minutes', 'body_json', 'body_html', 'published', 'published_at',
    'seo_title', 'seo_description', 'seo_og_image',
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  try {
    const story = await updateArticle(storyId, {
      title: update.title as string | undefined,
      subtitle: update.subtitle as string | null | undefined,
      slug: update.slug as string | undefined,
      category: update.category as string | null | undefined,
      excerpt: update.excerpt as string | null | undefined,
      body_json: update.body_json as object | null | undefined,
      read_minutes: update.read_minutes != null ? Number(update.read_minutes) : undefined,
      published: update.published as boolean | undefined,
      published_at: update.published_at as string | null | undefined,
      seo_title: update.seo_title as string | null | undefined,
      seo_description: update.seo_description as string | null | undefined,
      seo_og_image: update.seo_og_image as string | null | undefined,
    });
    // Direct ISR revalidation — bypasses Storyblok's webhook latency.
    // Best-effort: if it fails the article is still saved, just slower
    // to appear on the public site.
    await revalidateWebsite(`articles/${story.slug}`);
    return NextResponse.json({ id: String(story.id), slug: story.slug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to update article';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  const { id } = await ctx.params;
  const storyId = Number(id);

  try {
    await deleteArticle(storyId);
    // Revalidate the articles list so the deleted article disappears
    // from /articles and home immediately.
    await revalidateWebsite('articles/');
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to delete article';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
