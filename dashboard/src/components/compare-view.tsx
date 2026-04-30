'use client';

/**
 * Two-up A/B comparison: previous version on the left, current on the right.
 * On narrow viewports the layout stacks vertically so the previous version
 * sits on top and the current sits below — that ordering preserves the
 * "what changed?" reading direction (read prev, then read curr).
 *
 * Each side renders a minimal player + label so Yonah can hit play on both
 * and watch them side-by-side. We deliberately do NOT show feedback inputs
 * here — the user already submitted the feedback that produced the right-
 * side regen; compare mode is a verification view, not an input view.
 */

interface SideData {
  videoUrl: string | null;
  thumbUrl: string | null;
  captionsVttDataUrl: string | null;
  versionLabel: string;
  relativeTime: string;
}

interface Props {
  previous: SideData;
  current: SideData;
  /** Optional feedback text that triggered the current version. */
  feedbackText: string | null;
}

export function CompareView({ previous, current, feedbackText }: Props) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <div className="compare-grid" style={compareGridStyle}>
        <CompareSide data={previous} side="previous" />
        <CompareSide data={current} side="current" />
      </div>
      {feedbackText && (
        <p
          style={{
            marginTop: '14px',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            fontVariationSettings: '"opsz" 14, "SOFT" 60',
            lineHeight: 1.55,
          }}
        >
          Feedback that produced this regen:{' '}
          <span style={{ color: 'var(--ink-700)' }}>&ldquo;{feedbackText}&rdquo;</span>
        </p>
      )}
    </div>
  );
}

const compareGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '20px',
  alignItems: 'start',
};

function CompareSide({ data, side }: { data: SideData; side: 'previous' | 'current' }) {
  const accent = side === 'current' ? 'var(--cedar-500)' : 'var(--ink-200)';
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '8px',
          fontFamily: 'var(--ff-display)',
          fontSize: '12.5px',
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        <span style={{ color: side === 'current' ? 'var(--cedar-700)' : 'var(--ink-500)', fontWeight: side === 'current' ? 500 : 400 }}>
          {data.versionLabel}
        </span>
        <span style={{ color: 'var(--ink-400)' }}>{data.relativeTime}</span>
      </div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '280px',
          marginInline: 'auto',
          borderRadius: 'var(--r-lg)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-page)',
          background: 'var(--ink-900)',
          border: `1px solid ${accent}`,
        }}
      >
        {data.videoUrl ? (
          <video
            src={data.videoUrl}
            poster={data.thumbUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            crossOrigin={data.captionsVttDataUrl ? 'anonymous' : undefined}
            style={{
              width: '100%',
              aspectRatio: '9 / 16',
              display: 'block',
              background: 'var(--ink-900)',
            }}
          >
            {data.captionsVttDataUrl && (
              <track
                kind="captions"
                srcLang="en"
                label="English"
                default
                src={data.captionsVttDataUrl}
              />
            )}
          </video>
        ) : (
          <div
            style={{
              aspectRatio: '9 / 16',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--ink-800)',
              color: 'var(--linen-50)',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
              opacity: 0.6,
              padding: '24px',
              textAlign: 'center',
            }}
          >
            No video available.
          </div>
        )}
      </div>
    </div>
  );
}
