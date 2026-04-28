'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Claude is now routed through Kie.ai's Anthropic-compatible endpoint
// (https://api.kie.ai/claude/v1/messages) so all AI billing consolidates
// to a single vendor account for the end user. Same request/response shape
// as api.anthropic.com; auth is Bearer instead of x-api-key.
const KIE_CLAUDE_URL = 'https://api.kie.ai/claude/v1/messages';
const MODEL = 'claude-opus-4-6';

interface KieClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
}

// Aligned with src/topic_pipeline.py's SYSTEM — same voice, same length
// rules, same named-principle requirement — plus a tail asking for a
// title + tldr so we can index the new row in the carousel.
const SYSTEM = `You write SHORT-FORM dvar torah scripts — 45 seconds of video —
that fuse Torah and broader Jewish wisdom (parsha, kabbalah, chassidus,
mussar) with tai chi and Chinese internal-martial-arts principles. The
fusion is the whole point. Each tradition illuminates the other. A truth
emerges neither articulates alone.

**HARD LENGTH: 95-110 words. Over 115 is a failure. Over 130 is a disaster.**
This is short-form social video. It plays in 45 seconds. Every word is
real estate.

SHORT DOES NOT MEAN WATERED-DOWN. Pack density, don't dilute. Every
sentence earns its place by doing real work. No filler, no restatement,
no meandering. A single razor-sharp image beats five abstractions.

VOICE:
Deep, intelligent, sagely, coherent. An elder teacher who has lived in
both worlds. Measured. Contemplative. Authoritative without volume. This
is Rav Eli speaking — a mid-50s Jewish teacher who also trained decades
in Chinese internal arts.

YOU MUST INCLUDE:
- One specific tai chi / internal-arts principle — named (song 松, jin 勁,
  peng 掤, zhan zhuang, rooting, yielding, yi 意, li vs jin, etc.). NOT
  generic "flow" / "balance" / "harmony."
- A real Jewish wisdom anchor tied to the given parsha — the parsha's
  own teaching, or a chassidic/mussar/kabbalistic insight drawn from it.
- One concrete embodied moment — the body doing something real, not
  "feel the flow." A breath. A weight shift. A softening of the kua. A
  dropping of the shoulders before speaking.
- An opening line that grips in one sentence; a landing that completes
  the teaching and gently points the viewer back into their own life.

FREEDOM:
You are writing from Yonah's idea prompt for a specific parsha. You
choose the tai-chi principle. The Jewish anchor should be rooted in the
given parsha (don't jump to an unrelated parsha). Don't hedge. Pick one
pair and let them speak.

AVOID:
- Generic metaphors without a named principle behind them.
- Listing abstract qualities.
- Mystical throat-clearing.
- Teaching two ideas when one is enough.
- Any sentence that doesn't advance the teaching.
- Calling the viewer "friend" or "dear one" or similar — Rav Eli doesn't
  address them; he teaches, and they overhear.

OUTPUT FORMAT:
Return a single line of valid JSON with three keys (no markdown, no
code fence, no prose around it):
  {"title": "<3-6 word title, no trailing punctuation>",
   "tldr":  "<one sentence, 12-18 words, specific about the angle>",
   "draft_text": "<the 95-110 word script>"}
Count the words in draft_text before returning. If over 110, cut.`;

export interface CustomScriptResult {
  script?: {
    id: string;
    option: string;
    title: string | null;
    tldr: string | null;
    draft_text: string | null;
    director_notes: string | null;
  };
  error?: string;
}

export async function generateCustomScript(
  parshaId: string,
  ideaText: string,
): Promise<CustomScriptResult> {
  const idea = (ideaText ?? '').trim();
  if (!parshaId) return { error: 'Missing parsha id.' };
  if (!idea) return { error: 'Share your idea first.' };
  if (idea.length > 4000) return { error: 'Idea too long — keep it under 4000 characters.' };

  // Auth check (matches broadcast.ts pattern)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) return { error: 'KIE_AI_API_KEY not set' };

  // Look up parsha name/slug for the prompt + for revalidation.
  const { data: parsha, error: parshaErr } = await supabase
    .from('parshiot')
    .select('id, name, slug, hebrew_name')
    .eq('id', parshaId)
    .single();
  if (parshaErr || !parsha) {
    return { error: parshaErr?.message ?? 'Parsha not found.' };
  }

  // Generate the draft + metadata via Kie's Anthropic-compatible endpoint.
  let title: string;
  let tldr: string;
  let draft: string;
  try {
    const httpRes = await fetch(KIE_CLAUDE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              `Parsha: ${parsha.name}\n\n` +
              `Yonah's idea for this week:\n${idea}\n\n` +
              `Write the script and return JSON with title, tldr, draft_text.`,
          },
        ],
      }),
    });
    if (!httpRes.ok) {
      return { error: `Claude (via Kie): ${httpRes.status} ${await httpRes.text()}` };
    }
    const resp = (await httpRes.json()) as KieClaudeResponse;
    const first = resp.content?.[0];
    const raw = first && first.type === 'text' && first.text ? first.text.trim() : '';
    if (!raw) return { error: 'Claude returned no content.' };

    // Forgive accidental code fences.
    let cleaned = raw;
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    }
    const parsed = JSON.parse(cleaned) as {
      title?: unknown;
      tldr?: unknown;
      draft_text?: unknown;
    };
    title = String(parsed.title ?? '').trim().replace(/\.+$/, '');
    tldr = String(parsed.tldr ?? '').trim();
    draft = String(parsed.draft_text ?? '').trim();
    if (!title || !tldr || !draft) {
      return { error: 'Claude response missing required fields.' };
    }
  } catch (e) {
    return { error: `Claude: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Insert with service-role so we bypass RLS write policies (RLS on
  // scripts is currently SELECT-only for authed users — see 0001).
  const option = `custom-${Date.now()}`;
  const svc = createServiceClient();
  const { data: inserted, error: insertErr } = await svc
    .from('scripts')
    .insert({
      parsha_id: parshaId,
      option,
      title,
      tldr,
      draft_text: draft,
      style_note: 'custom-from-idea',
    })
    .select('id, option, title, tldr, draft_text, director_notes')
    .single();

  if (insertErr || !inserted) {
    return { error: insertErr?.message ?? 'Insert failed.' };
  }

  // Refresh the detail page so the new script appears on next server render.
  revalidatePath(`/videos/${parsha.slug}`);

  return { script: inserted };
}
