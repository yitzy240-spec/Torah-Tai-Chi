/**
 * On-demand ISR revalidation endpoint for Storyblok webhooks.
 *
 * Storyblok dashboard setup:
 *   Space Settings → Webhooks → Stories Published
 *   URL: https://torahtaichi.com/api/revalidate
 *   Secret: paste the value of STORYBLOK_WEBHOOK_SECRET
 *   (Storyblok sends it as the `webhook-signature` header)
 */

import { timingSafeEqual } from 'crypto';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Storyblok webhook payload shape (partial — only what we use)
interface StoryblokWebhookPayload {
  action?: string;
  story_id?: number;
  full_slug?: string;
  space_id?: number;
  text?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STORYBLOK_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed: never accept revalidation requests when the shared secret
    // is unconfigured. Otherwise the endpoint becomes an open DoS amplifier.
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 503 });
  }

  // Validate shared secret — Storyblok sends it as a header
  const incoming = req.headers.get('webhook-signature') ?? req.headers.get('x-storyblok-webhook-secret');
  if (!incoming) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const a = Buffer.from(incoming);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let payload: StoryblokWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { full_slug } = payload;

  if (!full_slug) {
    // No slug — revalidate everything
    revalidatePath('/', 'layout');
    return NextResponse.json({ revalidated: true, path: '/' });
  }

  // site-text stories affect every rendered page (hero text, about copy, etc.)
  if (full_slug.startsWith('site-text/') || full_slug.startsWith('book-folder/')) {
    revalidatePath('/', 'layout');
    return NextResponse.json({ revalidated: true, path: '/' });
  }

  // Article slug: "articles/why-the-body-knows" → /articles/why-the-body-knows
  if (full_slug.startsWith('articles/')) {
    const articleSlug = full_slug.replace(/^articles\//, '');
    revalidatePath(`/articles/${articleSlug}`);
    revalidatePath('/articles');
    revalidatePath('/'); // homepage shows recent articles
    return NextResponse.json({ revalidated: true, paths: [`/articles/${articleSlug}`, '/articles', '/'] });
  }

  // Fallback: revalidate the path directly
  const path = full_slug.startsWith('/') ? full_slug : `/${full_slug}`;
  revalidatePath(path);
  return NextResponse.json({ revalidated: true, path });
}
