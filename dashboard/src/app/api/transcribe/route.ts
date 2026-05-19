// dashboard/src/app/api/transcribe/route.ts
//
// POST /api/transcribe
// Body: multipart/form-data with field "audio" containing the audio blob.
// Returns: { text: string }
//
// Proxies the audio to OpenAI Whisper (model: whisper-1).
// Auth-checked: 401 if no session.
// Falls back gracefully if OPENAI_API_KEY is not set (returns 503).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured on this server' },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400 });
  }

  const audioBlob = formData.get('audio');
  if (!audioBlob || !(audioBlob instanceof Blob)) {
    return NextResponse.json({ error: '"audio" field is required (audio Blob)' }, { status: 400 });
  }

  // Forward to OpenAI Whisper
  const outForm = new FormData();
  outForm.append('file', audioBlob, 'recording.webm');
  outForm.append('model', 'whisper-1');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: outForm,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Whisper API error ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const json = (await res.json()) as { text?: string; error?: { message: string } };
    if (json.error) {
      return NextResponse.json({ error: json.error.message }, { status: 502 });
    }

    return NextResponse.json({ text: json.text ?? '' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
