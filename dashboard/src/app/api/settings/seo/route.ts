import { NextRequest, NextResponse } from 'next/server';
import { getSeoDefaults, updateSeoDefaults } from '@/lib/storyblok';
import { requireAuth } from '@/lib/api-auth';

export async function GET() {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  try {
    const story = await getSeoDefaults();
    return NextResponse.json({ seo: story?.content ?? {} });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch SEO defaults';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const story = await updateSeoDefaults({
      site_default_title: (body.site_default_title as string) ?? '',
      site_default_description: (body.site_default_description as string) ?? '',
      site_default_og_image: (body.site_default_og_image as string) ?? '',
      twitter_handle: (body.twitter_handle as string) ?? '',
    });
    return NextResponse.json({ seo: story.content });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to update SEO defaults';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
