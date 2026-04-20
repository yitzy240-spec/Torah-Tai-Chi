import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { randomBytes } from 'crypto';

const BUCKET = 'videos';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB for compose uploads — images only

/**
 * Upload a compose image to Supabase storage. Returns the public URL.
 * Auth: dashboard user session required. Uses service-role client for the
 * actual write so bucket RLS stays admin-only.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB cap)` }, { status: 413 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: `Only image/* allowed, got ${file.type}` }, { status: 415 });
  }

  const ext = file.type.split('/')[1]?.replace('+xml', '') ?? 'png';
  const key = `compose/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;

  const svc = createServiceClient();
  const { error: upErr } = await svc.storage.from(BUCKET).upload(key, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data } = svc.storage.from(BUCKET).getPublicUrl(key);
  return NextResponse.json({ url: data.publicUrl, key });
}
