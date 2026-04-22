'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Email + password sign-in. The dashboard moved away from magic links
 * because the mobile/cross-browser PKCE flow kept bouncing users back to
 * /login. Three known users; password auth is simpler + bulletproof.
 *
 * Default password is set centrally via tools/set_passwords.py and can be
 * changed by each user from /settings.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok?: true; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) return { error: 'Email required' };
  if (!password) return { error: 'Password required' };

  // Confirm the email is on the allowlist before attempting sign-in so a
  // typo doesn't produce a misleading "Invalid login credentials" error.
  const admin = createServiceClient();
  const { data, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) return { error: 'Could not verify email. Try again in a moment.' };
  const exists = data.users.some((u) => u.email?.toLowerCase() === trimmedEmail);
  if (!exists) {
    return { error: "This email isn't authorized. Ask Yitzy to add you." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Send a password-reset email via Supabase. Uses recovery flow which
 * lands on /auth/callback with the reset token in the URL fragment;
 * the callback shim establishes a session and the user can pick a new
 * password from /settings.
 */
export async function requestPasswordReset(
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
    return { error: "This email isn't authorized. Ask Yitzy to add you." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
  if (error) return { error: error.message };
  return { ok: true };
}
