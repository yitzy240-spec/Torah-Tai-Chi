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
3. PHONETICS POLICY — match Modal's clip-plan generator exactly:
   - Hebrew words that need pronunciation guidance appear in PHONETIC FORM ONLY, not paired with the standard spelling.
   - Correct: "Vah-yeek-RAH calls us in" / "the wisdom of KHEH-sed"
   - Wrong: "Vayikra (Vah-yeek-RAH)" / "chesed (KHEH-sed)" — never use parens to double-render.
   - Hyphenated, with CAPS on the stressed syllable. Aleph-bet letters that English speakers see as "Ch" in Hebrew transliteration should appear as "H" in phonetics (e.g., chesed → KHEH-sed, not CHEH-sed).
   - Tai Chi move names ("Wave Hands Like Clouds", "White Crane Spreads Its Wings") are NOT phonetics — leave them in their canonical English form.
   - If the input has the double-render form "chesed (KHEH-sed)", collapse it to phonetic-only "KHEH-sed" (or whatever the input's phonetic was).
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
