/**
 * AI image generation helpers — Claude expands a user brief into a
 * full image prompt, Kie.ai nano-banana-2 renders it, the result lands
 * in Supabase Storage keyed by the Kie task id (so polls are idempotent).
 */

import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/service';

const KIE_BASE = 'https://api.kie.ai/api/v1';
const BUCKET = 'videos';
const COMPOSE_PREFIX = 'compose/ai-images';

const SUPABASE_PUBLIC = (key: string) =>
  `https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/${BUCKET}/${key}`;

export const REFERENCE_ASSETS = {
  'rav-eli': SUPABASE_PUBLIC('references/rav_eli_canonical.png'),
  logo: SUPABASE_PUBLIC('references/logo.png'),
} as const;

export type ReferenceKind = keyof typeof REFERENCE_ASSETS | 'custom' | 'none';

export type AspectRatio = '1:1' | '9:16' | '16:9';

const BRAND_GUIDANCE = `Brand aesthetic for Torah Tai Chi:
- Warm linen + cedar + deep navy palette
- Contemplative, editorial, museum-quality — NOT tech-startup, NOT cartoonish
- Soft cinematic lighting, golden hour / interior warm lighting preferred
- Rich natural textures (wood grain, paper fiber, fabric weave)
- Minimal composition with generous negative space
- Cinematic depth of field
- Hebrew letterforms welcome when relevant; Fraunces-style editorial serif for Latin
- When a person is referenced, respect the reference image's face, clothing, vibe exactly
- When the logo is referenced, preserve its exact design (cedar disc, yin-yang, Star of David in TOP lobe)`;

export async function expandPrompt(args: {
  userPrompt: string;
  hasReference: boolean;
  feedback?: string;
  previousPrompt?: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const anthropic = new Anthropic({ apiKey });

  const system = `You're the brand art director for Torah Tai Chi. Expand a short user brief into a single, detailed image prompt for the nano-banana-2 model. Return ONLY the prompt text — no preamble, no markdown headings, no "Here is", no bullet points. Length: 150–300 words.

${BRAND_GUIDANCE}`;

  const refLine = args.hasReference
    ? `\n\nA reference image is attached. Treat it as visual ground truth — match face, clothing, logo, or setting exactly.`
    : '';
  const feedbackLine = args.feedback && args.previousPrompt
    ? `\n\nYour previous prompt was:\n"""\n${args.previousPrompt}\n"""\n\nThe user's feedback on the result: ${args.feedback}\n\nRevise the prompt to address that feedback while keeping what worked.`
    : '';

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: `User brief: ${args.userPrompt}${refLine}${feedbackLine}` }],
  });

  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim();
  if (!text) throw new Error('Prompt expansion returned empty');
  return text;
}

/** Create a Kie.ai nano-banana-2 task; returns the taskId. */
export async function createKieImageTask(args: {
  expandedPrompt: string;
  referenceUrls?: string[];
  aspectRatio?: AspectRatio;
}): Promise<string> {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) throw new Error('KIE_AI_API_KEY not set');

  const body = {
    model: 'nano-banana-2',
    input: {
      prompt: args.expandedPrompt,
      ...(args.referenceUrls && args.referenceUrls.length > 0
        ? { image_input: args.referenceUrls }
        : {}),
      aspect_ratio: args.aspectRatio ?? '1:1',
      resolution: '2K',
      output_format: 'png',
    },
  };

  const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Kie createTask: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { code: number; data?: { taskId: string }; msg?: string };
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`Kie createTask error: ${JSON.stringify(data)}`);
  }
  return data.data.taskId;
}

export type KiePollResult =
  | { state: 'pending' }
  | { state: 'success'; url: string; expandedPrompt?: string }
  | { state: 'failed'; error: string };

/**
 * One poll of a Kie.ai task. On success, mirror the result image to Supabase
 * Storage (idempotent — keyed by taskId) and return the public URL.
 */
export async function pollKieImageTask(taskId: string): Promise<KiePollResult> {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) throw new Error('KIE_AI_API_KEY not set');

  const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Kie recordInfo: ${res.status}`);
  const data = (await res.json()) as {
    data?: { state?: string; resultJson?: string | object; failCode?: string; failMsg?: string };
  };
  const d = data.data ?? {};
  const state = d.state;

  if (state === 'fail') {
    return { state: 'failed', error: `${d.failCode ?? 'unknown'}: ${d.failMsg ?? 'no detail'}` };
  }
  if (state !== 'success') {
    return { state: 'pending' };
  }

  const resultJson = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
  const urls: string[] = (resultJson as { resultUrls?: string[] })?.resultUrls ?? [];
  if (urls.length === 0) return { state: 'failed', error: 'success but no result URLs' };

  // Mirror to our Supabase Storage so the URL is permanent and bucket-ACL'd.
  const key = `${COMPOSE_PREFIX}/${taskId}.png`;
  const svc = createServiceClient();

  // Check if we've already mirrored this task (idempotent).
  const publicUrl = SUPABASE_PUBLIC(key);
  const head = await fetch(publicUrl, { method: 'HEAD' }).catch(() => null);
  if (head?.ok) return { state: 'success', url: publicUrl };

  // Download from Kie + upload to Supabase.
  const imgRes = await fetch(urls[0]);
  if (!imgRes.ok) throw new Error(`Download Kie image: ${imgRes.status}`);
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  const { error: upErr } = await svc.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true,
  });
  if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);

  return { state: 'success', url: publicUrl };
}
