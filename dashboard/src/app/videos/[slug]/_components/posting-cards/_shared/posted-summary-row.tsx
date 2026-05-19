// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/posted-summary-row.tsx
//
// Collapsed posted-state row: status pill + platform name + posted-date + view-link + expand arrow.
// Tapping expands the card to show read-only caption + "Edit on [Platform]" button.

interface Props {
  icon: string;           // emoji or label e.g. "📱" "📷" "▶️"
  platform: string;       // display name e.g. "TikTok"
  postedAt: string;       // ISO datetime string
  viewsLabel?: string;    // e.g. "2.4k views" — optional
  postUrl: string | null;
  onExpand: () => void;
}

export function PostedSummaryRow({ icon, platform, postedAt, viewsLabel, postUrl, onExpand }: Props) {
  const dateStr = new Date(postedAt).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <button
      type="button"
      onClick={onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        minHeight: 56,
        padding: '12px 14px',
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        background: 'var(--linen-50)',
        cursor: 'pointer',
        textAlign: 'left',
        marginBottom: 12,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
          <span style={{ color: 'var(--jade)' }}>●</span> {icon} {platform}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
          Posted {dateStr}
          {viewsLabel ? ` · ${viewsLabel}` : ''}
          {postUrl && (
            <>
              {' · '}
              <a
                href={postUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--navy-700)', textDecoration: 'underline' }}
              >
                View →
              </a>
            </>
          )}
        </div>
      </div>
      <span style={{ fontSize: 18, color: 'var(--ink-400)', marginLeft: 8 }}>▸</span>
    </button>
  );
}
