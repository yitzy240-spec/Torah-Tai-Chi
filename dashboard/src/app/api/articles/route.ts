import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('articles')
    .insert({
      title: body.title ?? null,
      subtitle: body.subtitle ?? null,
      slug: body.slug ?? null,
      category: body.category ?? null,
      excerpt: body.excerpt ?? null,
      read_minutes: body.read_minutes ?? null,
      body_json: body.body_json ?? null,
      body_html: body.body_html ?? null,
      published: body.published ?? false,
      published_at: body.published_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
