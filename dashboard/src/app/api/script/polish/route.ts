// dashboard/src/app/api/script/polish/route.ts
//
// POST /api/script/polish
// Body: { original: string }
// Returns: { polished: string }
//
// Calls Claude via lib/claude.ts to improve flow while strictly preserving
// all phonetic spellings. Auth-checked: 401 if no session.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { callClaude } from '@/lib/claude';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are an editor for Torah Tai Chi video scripts. Your job is to polish a voiceover script for flow and clarity.

Rules — follow ALL of them:
1. Improve flow, rhythm, and readability for spoken delivery.
2. Fix awkward phrasing, clunky transitions, or sentences that are hard to say aloud.
3. PRESERVE all phonetic spellings exactly as written (e.g., "chesed (KHEH-sed)", "Wave Hands Like Clouds"). Do not alter, remove, or "fix" them — they exist for the TTS voice.
4. Keep the same approximate length (do not add or remove more than ~10 words).
5. Do not change the structure or main ideas — only improve the expression.
6. Return ONLY the polished script text. No explanation, no preamble, no markdown.`;

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let body: { original?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const original = (body.original ?? '').trim();
  if (!original) {
    return NextResponse.json({ error: '"original" field is required' }, { status: 400 });
  }

  try {
    const polished = await callClaude({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: original,
      maxTokens: 800,
    });

    return NextResponse.json({ polished: polished.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
