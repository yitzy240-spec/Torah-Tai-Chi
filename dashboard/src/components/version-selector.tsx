'use client';

/**
 * Compact header bar shown above the video player on /videos/[slug].
 *
 *   [<] Version 3 of 3 · 12 min ago [>]    [Compare ⇄]
 *
 * Yonah uses this to flip between regen versions for the same parsha so he
 * can verify that a feedback round actually addressed what he asked for.
 * Boundaries disable the chevrons; Compare is hidden when only one version
 * exists.
 *
 * Stateless — the parent owns the selected index + compare flag and pushes
 * URL state via router.replace. We just render and call onNavigate.
 */
export interface VersionSelectorProps {
  total: number;
  /** 0-based index of the currently-selected version. */
  selectedIndex: number;
  /** Relative time string for the selected version (e.g. "5 min ago"). */
  relativeTime: string;
  compareMode: boolean;
  /** When false, hide the Compare button entirely (only one version). */
  canCompare: boolean;
  onNavigate: (newIndex: number) => void;
  onToggleCompare: () => void;
  onExitCompare: () => void;
}

export function VersionSelector({
  total,
  selectedIndex,
  relativeTime,
  compareMode,
  canCompare,
  onNavigate,
  onToggleCompare,
  onExitCompare,
}: VersionSelectorProps) {
  const atFirst = selectedIndex <= 0;
  const atLast = selectedIndex >= total - 1;
  const versionLabel = `Version ${selectedIndex + 1} of ${total}`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '10px 14px',
        marginBottom: '14px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-md)',
        background: 'var(--linen-50)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <ChevronButton
          direction="left"
          disabled={atFirst}
          onClick={() => !atFirst && onNavigate(selectedIndex - 1)}
          ariaLabel="Previous version"
        />
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-700)',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {versionLabel}
          <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
          <span style={{ color: 'var(--ink-500)' }}>{relativeTime}</span>
        </div>
        <ChevronButton
          direction="right"
          disabled={atLast}
          onClick={() => !atLast && onNavigate(selectedIndex + 1)}
          ariaLabel="Next version"
        />
      </div>
      {canCompare && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          {compareMode ? (
            <button
              type="button"
              onClick={onExitCompare}
              style={pillButtonStyle(true)}
              aria-label="Close compare mode"
            >
              <span aria-hidden="true">×</span>
              Close compare
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCompare}
              style={pillButtonStyle(false)}
              aria-label="Compare with previous version"
              disabled={total < 2}
            >
              Compare
              <span aria-hidden="true" style={{ fontSize: '13px' }}>
                ⇄
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronButton({
  direction,
  disabled,
  onClick,
  ariaLabel,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        width: '32px',
        height: '32px',
        minHeight: '32px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--ink-200)',
        borderRadius: '999px',
        background: 'var(--linen-50)',
        color: disabled ? 'var(--ink-300)' : 'var(--ink-700)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '15px',
        lineHeight: 1,
        padding: 0,
        opacity: disabled ? 0.55 : 1,
        transition: 'all var(--trans)',
      }}
    >
      {direction === 'left' ? '‹' : '›'}
    </button>
  );
}

function pillButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--ff-body)',
    fontWeight: 500,
    fontSize: '12.5px',
    padding: '7px 14px',
    minHeight: '32px',
    borderRadius: '999px',
    border: `1px solid ${active ? 'var(--navy-800)' : 'var(--ink-200)'}`,
    background: active ? 'var(--navy-800)' : 'var(--linen-50)',
    color: active ? 'var(--linen-50)' : 'var(--ink-700)',
    cursor: 'pointer',
    transition: 'all var(--trans)',
    letterSpacing: '0.01em',
  };
}
