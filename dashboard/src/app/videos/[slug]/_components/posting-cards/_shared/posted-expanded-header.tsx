'use client';
import type { ReactNode } from 'react';

interface Props {
  platformName: string;
  icon: ReactNode;
  onCollapse: () => void;
}

export function PostedExpandedHeader({ platformName, icon, onCollapse }: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <div>
        <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {icon} {platformName}
        </strong>
        <span style={{ fontSize: 11, color: 'var(--jade)', marginLeft: 6 }}>● Posted</span>
      </div>
      <button
        type="button"
        onClick={onCollapse}
        style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 18 }}
      >
        ▴
      </button>
    </div>
  );
}
