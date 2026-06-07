'use client';
import type { ReactNode } from 'react';

interface Props {
  platformName: string;
  icon: ReactNode;
  /** Suffix after platform name, default "next up". YouTube uses "Short · next up". */
  suffix?: string;
  children: ReactNode;
}

export function UnpostedCardShell({ platformName, icon, suffix = 'next up', children }: Props) {
  return (
    <div style={{ border: '1.5px solid var(--navy-700)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'white' }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {platformName} · {suffix}
      </div>
      {children}
    </div>
  );
}
