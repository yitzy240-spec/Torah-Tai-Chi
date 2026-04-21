import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in tests/qa/.env.qa');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function ensureTestUser(email: string, name: string): Promise<string> {
  const admin = serviceClient();
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  return data.user.id;
}

export async function deleteTestUser(email: string): Promise<void> {
  const admin = serviceClient();
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error) throw error;
  }
}

export async function generateMagicLinkAction(email: string, redirectTo: string): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  const link = data?.properties?.action_link;
  if (!link) throw new Error('generateLink returned no action_link');
  return link;
}
