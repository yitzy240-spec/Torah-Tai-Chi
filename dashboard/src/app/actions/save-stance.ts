'use server';

import { createClient } from '@/lib/supabase/server';
import { setStance, type Stance } from '@/lib/stance';
import { logEvent } from '@/lib/events';
import { revalidatePath } from 'next/cache';

export async function saveStance(stance: Stance): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  try {
    await setStance(stance);
    await logEvent({
      actor: 'yonah',
      level: 'action',
      event: 'stance.saved',
      message: `Stance set to ${stance}`,
      details: { stance, actorUserId: user.id },
    });
    revalidatePath('/');
    revalidatePath('/settings');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent({
      actor: 'yonah',
      level: 'error',
      event: 'stance.error',
      message: `Stance save failed: ${msg}`,
      details: { stance, error: msg },
    });
    return { ok: false, error: msg };
  }
}
