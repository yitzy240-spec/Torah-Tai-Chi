'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Change the signed-in user's password. Uses the user's session — no
 * service-role bypass — so a stolen anon key still can't change anyone
 * else's password. Length-checked client-side; we re-check here to be safe.
 */
export async function changePassword(
  newPassword: string,
): Promise<{ ok?: true; error?: string }> {
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}
