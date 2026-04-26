import { createServiceClient } from '@/lib/supabase/service';
import { MessagesViewer, type ViewerMessage } from './messages-viewer';

export const dynamic = 'force-dynamic';

interface MessageRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  message: string;
  sent_via_email: boolean;
  ip: string | null;
}

/**
 * Messages — submissions from the website's /contact form, newest first.
 *
 * Service-role read so we see everything (the table also has an RLS
 * policy that lets any authenticated user select, but using the service
 * role here matches the rest of the admin routes).
 *
 * `sent_via_email` distinguishes "store-only" rows (Resend not yet
 * configured) from rows that were also delivered as email.
 */
export default async function MessagesPage() {
  const svc = createServiceClient();

  const { data: rowsData, error } = await svc
    .from('contact_messages')
    .select('id, created_at, name, email, message, sent_via_email, ip')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: MessageRow[] = (rowsData ?? []) as MessageRow[];
  const messages: ViewerMessage[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    name: r.name,
    email: r.email,
    message: r.message,
    sentViaEmail: !!r.sent_via_email,
    ip: r.ip,
  }));

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '28px',
            letterSpacing: '-0.015em',
            margin: '0 0 6px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 48, "SOFT" 30',
          }}
        >
          Messages
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            margin: 0,
          }}
        >
          {error
            ? `Failed to load messages: ${error.message}`
            : messages.length === 0
              ? 'No contact-form submissions yet.'
              : `Last ${messages.length} contact-form submissions, newest first.`}
        </p>
      </div>

      <MessagesViewer messages={messages} />
    </div>
  );
}
