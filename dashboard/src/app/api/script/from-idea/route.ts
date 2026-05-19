// dashboard/src/app/api/script/from-idea/route.ts
//
// POST /api/script/from-idea
// Body: { idea: string, parshaSlug?: string }
// Returns: { draftText: string, title: string }
//
// Calls Claude via lib/claude.ts with a Torah Tai Chi script-generation
// system prompt. Auth-checked: 401 if no session.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { callClaude } from '@/lib/claude';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a script writer for Torah Tai Chi, a short-form video series that teaches Torah wisdom through narrated Tai Chi movement.

Each video is approximately 60 seconds long with a voiceover narrated by "Rav Eli" — a warm, wise teacher rendered as a Pixar-style 3D character. The script drives AI-generated clips of Rav Eli performing Tai Chi moves.

Script guidelines:
- Target length: ~130–156 words (spoken at ~2.6 words per second = 50–60 seconds).
- Tone: warm, accessible, gently poetic. Not preachy. Short sentences.
- Structure: brief Torah insight → connect to Tai Chi movement → practical takeaway.
- Include phonetic spellings for Hebrew words (e.g., "chesed (KHEH-sed)") and Tai Chi move names (e.g., "Wave Hands Like Clouds") so the TTS voiceover reads them correctly.
- Do NOT include stage directions, music cues, or clip breaks — only the spoken voiceover text.

Respond with JSON in this exact format (no markdown fences):
{
  "title": "Short punchy title (5–8 words)",
  "draftText": "The full voiceover script..."
}`;

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let body: { idea?: string; parshaSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const idea = (body.idea ?? '').trim();
  if (!idea) {
    return NextResponse.json({ error: '"idea" field is required' }, { status: 400 });
  }

  const userPrompt = body.parshaSlug
    ? `Parsha context: ${body.parshaSlug}\n\nIdea: ${idea}`
    : `Idea: ${idea}`;

  try {
    const raw = await callClaude({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 800,
    });

    // Strip markdown fences if the model added them anyway
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

    let parsed: { title?: string; draftText?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: return raw text as draftText if JSON parse fails
      return NextResponse.json({ draftText: raw, title: 'Draft script' });
    }

    return NextResponse.json({
      draftText: parsed.draftText ?? raw,
      title: parsed.title ?? 'Draft script',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
