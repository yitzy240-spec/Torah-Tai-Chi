'use server';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';

export async function requestLoginLink(
  email: string,
  redirectTo: string,
): Promise<{ ok?: true; error?: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { error: 'Email required' };

  const admin = createServiceClient();
  const { data, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) return { error: 'Could not verify email. Try again in a moment.' };

  const exists = data.users.some((u) => u.email?.toLowerCase() === trimmed);
  if (!exists) {
    return { error: "This email isn't authorized. Ask an admin to add you in Settings." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) return { error: error.message };
  return { ok: true };
}
