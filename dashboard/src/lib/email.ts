/**
 * Operator notifications via Resend.
 *
 * Used by the pipeline webhooks to ping Yonah when a video either
 * succeeds or fails. Mirrors the website's contact-form email lib
 * (raw fetch, no Resend SDK dep) so the dashboard doesn't grow a new
 * dependency just to send a couple of transactional messages.
 *
 * Env contract:
 *   RESEND_API_KEY  — required to actually send. If missing, the
 *                     helper logs a warning and returns an error
 *                     result without throwing, so a misconfigured
 *                     env never breaks the pipeline.
 *   EMAIL_FROM      — verified Resend sender, e.g.
 *                     "Torah Tai Chi <notifications@torahtaichi.com>".
 *   NOTIFY_EMAIL    — recipient. Defaults to info@torahtaichi.com so
 *                     a missing env still routes somewhere sane.
 */
export async function sendNotification(opts: {
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const notifyEmail = process.env.NOTIFY_EMAIL ?? 'info@torahtaichi.com';

  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY missing — skipping notification');
    return { error: 'RESEND_API_KEY missing' };
  }
  if (!from) {
    console.warn('[email] EMAIL_FROM missing — skipping notification');
    return { error: 'EMAIL_FROM missing' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [notifyEmail],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[email] Resend returned ${res.status}: ${body.slice(0, 300)}`,
      );
      return { error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] Resend fetch threw: ${msg}`);
    return { error: msg };
  }
}
