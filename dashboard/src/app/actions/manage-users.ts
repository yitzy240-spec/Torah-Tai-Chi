'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

export interface ProvisionedUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  isSelf: boolean;
}

async function requireSession(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  return { userId: user.id };
}

export async function listUsers(): Promise<{ users?: ProvisionedUser[]; error?: string }> {
  const session = await requireSession();
  if ('error' in session) return { error: session.error };

  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) return { error: error.message };

  const users: ProvisionedUser[] = data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      name: (u.user_metadata?.name as string | undefined) ?? null,
      createdAt: u.created_at,
      isSelf: u.id === session.userId,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { users };
}

export async function addUser(
  email: string,
  name?: string,
): Promise<{ ok?: true; error?: string }> {
  const session = await requireSession();
  if ('error' in session) return { error: session.error };

  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { error: 'Enter a valid email' };
  }

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.createUser({
    email: trimmed,
    email_confirm: true,
    user_metadata: name ? { name: name.trim() } : undefined,
  });
  if (error) {
    if (error.message.toLowerCase().includes('already')) {
      return { error: 'That email is already registered.' };
    }
    return { error: error.message };
  }

  revalidatePath('/settings');
  return { ok: true };
}

export async function removeUser(userId: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireSession();
  if ('error' in session) return { error: session.error };
  if (userId === session.userId) return { error: "You can't remove yourself." };

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { ok: true };
}
