/**
 * Send an email via Resend if RESEND_API_KEY is configured. Returns true
 * if a message was actually sent. Returns false (no-op) when the env var
 * is missing — that's the 'store-only' mode used until the user creates
 * a Resend account. Adding the env var enables email delivery without
 * any code change.
 *
 * Uses raw fetch against https://api.resend.com/emails so we don't pull
 * in the Resend SDK as a dependency. When the user is ready to flip the
 * switch, they only need to:
 *   1. Create a Resend account, verify torahtaichi.com sender domain
 *   2. Set RESEND_API_KEY (and optionally CONTACT_TO_EMAIL /
 *      CONTACT_FROM_EMAIL) on Vercel
 *   3. Redeploy — no code change required.
 */
export async function tryEmailContact(args: {
  name: string;
  email: string;
  message: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const { name, email, message } = args;
  const to = process.env.CONTACT_TO_EMAIL ?? 'info@torahtaichi.com';
  const from =
    process.env.CONTACT_FROM_EMAIL ??
    'Torah Tai Chi Contact <noreply@torahtaichi.com>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `Contact form: ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
