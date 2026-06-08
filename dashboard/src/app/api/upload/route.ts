import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { uploadAsset } from '@/lib/storyblok-assets';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 });
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 415 });
  }

  try {
    const url = await uploadAsset(file);
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
