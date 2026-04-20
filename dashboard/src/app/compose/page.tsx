import { listProfiles } from '@/lib/buffer';
import { ComposeForm } from './compose-form';

export const metadata = { title: 'Compose — Torah Tai Chi' };
export const dynamic = 'force-dynamic';

interface AvailableChannel {
  id: string;
  service: string;
  username: string;
}

async function getBufferChannels(): Promise<AvailableChannel[]> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) return [];
  try {
    const profiles = await listProfiles(token);
    return profiles.map((p) => ({ id: p.id, service: p.service, username: p.service_username }));
  } catch {
    return [];
  }
}

export default async function ComposePage() {
  const channels = await getBufferChannels();

  return (
    <div className="stagger" style={{ maxWidth: '720px' }}>
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Compose{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>
            a post.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '16px',
            color: 'var(--ink-500)',
            margin: '0 0 40px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          Ad-hoc broadcasts to your Buffer channels — announcements, welcome
          posts, anything that isn&apos;t a weekly parsha video. For video
          posts use the Schedule-all flow on a video page.
        </p>
      </div>

      {channels.length === 0 ? (
        <div
          style={{
            padding: '24px 28px',
            border: '1px dashed var(--ink-200)',
            borderRadius: 'var(--r-lg)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14.5px',
            color: 'var(--ink-500)',
            lineHeight: 1.55,
          }}
        >
          No Buffer channels connected. Connect at least one channel in{' '}
          <a href="https://publish.buffer.com/channels" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy-700)' }}>publish.buffer.com/channels ↗</a>, then reload this page.
        </div>
      ) : (
        <ComposeForm channels={channels} />
      )}
    </div>
  );
}
