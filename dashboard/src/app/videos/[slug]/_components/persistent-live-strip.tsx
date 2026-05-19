// dashboard/src/app/videos/[slug]/_components/persistent-live-strip.tsx
//
// Pinned to the top of every draft phase when a live version exists.
// Per spec §3.1: "no matter where Yonah is, he sees what's live."
// Does NOT render on the live-at-rest state (that whole state IS the
// live status display). Only shown in the "live-and-draft" page state,
// across every phase view — kills the Bamidbar 2026-05-15 confusion.

import { PlatformIcon } from '@/components/platform-icon';

interface LivePost {
  platform: string;
  url: string | null;
}

interface Props {
  liveVersionLabel: string;      // e.g. "v2"
  publishedToWebsite: boolean;
  websiteUrl: string;
  livePosts: LivePost[];         // only platforms with status='published'
}

export function PersistentLiveStrip({
  liveVersionLabel,
  publishedToWebsite,
  websiteUrl,
  livePosts,
}: Props) {
  const channels: React.ReactNode[] = [];

  if (publishedToWebsite) {
    channels.push(
      <span key="website" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <PlatformIcon name="website" size={14} />
        torahtaichi.com
      </span>,
    );
  }

  livePosts.forEach((p) => {
    const platformName = p.platform as 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'twitter' | 'website';
    const displayName = p.platform === 'twitter' ? 'X' : p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
    channels.push(
      <span key={p.platform} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <PlatformIcon name={platformName} size={14} />
        {displayName}
      </span>,
    );
  });

  if (channels.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        background: 'var(--linen-50)',
        border: '1px solid var(--jade)',
        borderRadius: 'var(--r-md)',
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--jade)',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <strong>{liveVersionLabel}</strong>
        <span style={{ color: 'var(--ink-500)' }}>still live on</span>
        {channels.map((ch, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-700)' }}>
            {i > 0 && <span style={{ color: 'var(--ink-300)' }}>·</span>}
            {ch}
          </span>
        ))}
      </span>
      <a
        href={websiteUrl}
        target="_blank"
        rel="noreferrer"
        style={{
          marginLeft: 'auto',
          color: 'var(--navy-700)',
          textDecoration: 'underline',
          fontSize: 12,
          whiteSpace: 'nowrap',
        }}
      >
        View →
      </a>
    </div>
  );
}
