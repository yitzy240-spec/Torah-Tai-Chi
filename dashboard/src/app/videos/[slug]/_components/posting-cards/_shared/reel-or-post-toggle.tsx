// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/reel-or-post-toggle.tsx
//
// Segmented control for IG/FB post type. Reels are the default for video content.
// Value persists into social_metadata via saveSocialMetadata server action.

'use client';

interface Props {
  value: 'reel' | 'post';
  onChange: (v: 'reel' | 'post') => void;
}

export function ReelOrPostToggle({ value, onChange }: Props) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 6 }}>
        Post type
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['reel', 'post'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              flex: 1,
              minHeight: 44,
              padding: 10,
              border: `1.5px solid ${value === k ? 'var(--navy-700)' : 'var(--ink-100)'}`,
              background: value === k ? 'rgba(26,42,74,0.06)' : 'white',
              color: value === k ? 'var(--navy-700)' : 'var(--ink-500)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: value === k ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {value === k ? '●' : '○'} {k === 'reel' ? 'Reel' : 'Feed post'}
          </button>
        ))}
      </div>
    </div>
  );
}
