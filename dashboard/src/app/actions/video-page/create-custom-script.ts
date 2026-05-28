'use server';
//
// Insert a new `scripts` row for Yonah's custom-written or AI-from-idea
// content. Returns the new script_id so Phase 1's Generate-clip-plan
// advance handler can route the URL at this new row instead of falling
// back to the AI default script.
//
// Without this action, Write and From-Idea modes were dead-ends (text
// stayed in localStorage / React state, advance pointed to defaultScript.id,
// Modal generated from the wrong text). 2026-05-28 fix.
//
// `option` is the (parsha_id, option) unique tiebreaker. Original A/B/C
// scripts are the AI variants; we pick 'custom-' + a short random suffix
// so multiple custom attempts per parsha don't collide.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

export interface CreateCustomScriptArgs {
  parshaId: string;
  title: string;
  draftText: string;
  /** Optional 1-2 sentence summary used for videos.description / website. */
  tldr?: string;
}

export type CreateCustomScriptResult =
  | { ok: true; scriptId: string }
  | { ok: false; error: string };

function randomSuffix(): string {
  // 6 hex chars from crypto.getRandomValues. Uniqueness within a parsha
  // is enough for the (parsha_id, option) unique constraint to hold.
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createCustomScript(
  args: CreateCustomScriptArgs,
): Promise<CreateCustomScriptResult> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  if (!args.parshaId) return { ok: false, error: 'Missing parshaId' };
  const title = args.title.trim();
  const draftText = args.draftText.trim();
  if (!title) return { ok: false, error: 'Title is required' };
  if (!draftText) return { ok: false, error: 'Script text is required' };

  // Service role insert: the scripts table's RLS allows authed READ but
  // INSERT/UPDATE go through service role (see save-script.ts for the
  // same pattern).
  const svc = createServiceClient();
  const option = `custom-${randomSuffix()}`;
  const { data: row, error } = await svc
    .from('scripts')
    .insert({
      parsha_id: args.parshaId,
      option,
      title,
      draft_text: draftText,
      tldr: args.tldr?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message ?? 'Failed to insert script row' };
  }

  revalidatePath('/', 'layout');
  return { ok: true, scriptId: row.id as string };
}
