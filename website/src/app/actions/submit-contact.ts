'use server';

import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/service';
import { tryEmailContact } from '@/lib/email';

export interface ContactInput {
  name: string;
  email: string;
  message: string;
  /** Honeypot field — bots fill this; real users never see it. */
  website?: string;
}

export type ContactResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate, persist, and (optionally) email a contact-form submission.
 *
 * Today this writes to the `contact_messages` table via the service-role
 * client. Email delivery is opt-in: see `tryEmailContact` — until
 * RESEND_API_KEY is set the function silently returns false and the row
 * stays with sent_via_email=false.
 *
 * Bots fill the hidden `website` field; we silently no-op for them so
 * they don't learn whether the form succeeded.
 */
export async function submitContactMessage(
  input: ContactInput,
): Promise<ContactResult> {
  // Honeypot — drop silently and pretend success.
  if (input.website && input.website.trim().length > 0) {
    return { ok: true };
  }

  const name = (input.name ?? '').trim();
  const email = (input.email ?? '').trim().toLowerCase();
  const message = (input.message ?? '').trim();

  if (!name) return { ok: false, error: 'Name is required' };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'A valid email is required' };
  }
  if (!message || message.length < 10) {
    return { ok: false, error: 'Please add a bit more detail' };
  }
  if (message.length > 5000) {
    return { ok: false, error: 'Message too long (max 5000 characters)' };
  }

  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    hdrs.get('x-real-ip')?.trim() ??
    null;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from('contact_messages')
    .insert({ name, email, message, ip })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: 'Could not save message. Please try again.' };
  }

  // Try to email — no-op when RESEND_API_KEY is missing.
  const emailed = await tryEmailContact({ name, email, message });
  if (emailed) {
    await sb
      .from('contact_messages')
      .update({ sent_via_email: true })
      .eq('id', data.id);
  }

  return { ok: true };
}
