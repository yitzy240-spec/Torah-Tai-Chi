'use server';
import { createServiceClient } from '@/lib/supabase/service';

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

  // Use admin.generateLink (implicit flow — tokens in URL fragment) instead
  // of signInWithOtp (PKCE — requires the verifier in the SAME browser's
  // cookies). PKCE silently fails when the user requests the link in one
  // browser (e.g. Chrome on phone) and opens it in another (e.g. Gmail app's
  // in-app webview), bouncing them back to /login. Implicit flow has no
  // per-browser state so it works across any browser/email-app context.
  // The /auth/callback route has a JS shim that handles the fragment.
  const { error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: trimmed,
    options: { redirectTo },
  });
  if (error) return { error: error.message };
  return { ok: true };
}
