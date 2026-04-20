import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/events';
import { randomBytes } from 'crypto';

const BUCKET = 'videos';
// Supabase storage limit (enforced server-side too); Vercel's request-body
// cap (4.5 MB on Hobby/Pro) doesn't matter because we sign and the client
// PUTs the bytes directly to Supabase, not through us.
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Issue a signed upload URL for a compose image. The client PUTs file
 * bytes directly to Supabase Storage with this URL — no bytes flow through
 * Vercel, so the 4.5 MB request-body cap doesn't apply.
 *
 * Request body: { filename: string, contentType: string, size: number }
 * Response:     { signedUrl, token, publicUrl, key }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { filename?: string; contentType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { filename, contentType, size } = body;
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType required' }, { status: 400 });
  }
  if (typeof size === 'number' && size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(size / 1024 / 1024).toFixed(1)}MB > ${MAX_BYTES / 1024 / 1024}MB cap)` }, { status: 413 });
  }
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: `Only image/* allowed, got ${contentType}` }, { status: 415 });
  }

  const ext = (contentType.split('/')[1] ?? 'png').replace('+xml', '').replace(/[^a-z0-9]/gi, '');
  const key = `compose/${Date.now()}-${randomBytes(6).toString('hex')}.${ext || 'png'}`;

  const svc = createServiceClient();
  const { data: signed, error: sigErr } = await svc.storage
    .from(BUCKET)
    .createSignedUploadUrl(key);
  if (sigErr || !signed) {
    const msg = `Sign failed: ${sigErr?.message ?? 'unknown'}`;
    await logEvent({
      actor: 'supabase',
      level: 'error',
      event: 'compose.upload.sign.error',
      message: msg,
      details: {
        bucket: BUCKET,
        key,
        contentType,
        size: size ?? null,
        error: sigErr?.message ?? 'unknown',
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(key);
  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token: signed.token,
    publicUrl: pub.publicUrl,
    key,
  });
}
