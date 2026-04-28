import { NextRequest, NextResponse } from 'next/server';
import { upsertSiteText } from '@/lib/storyblok';
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

  const key = String(body.key ?? '').trim();
  const value = String(body.value ?? '');

  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  try {
    await upsertSiteText(key, value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
