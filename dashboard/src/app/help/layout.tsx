import Link from 'next/link';
import type { ReactNode } from 'react';

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: '680px' }}>
      <div style={{ marginBottom: '32px' }}>
        <Link
          href="/help"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-400)',
            textDecoration: 'none',
            letterSpacing: '0.03em',
          }}
        >
          ← Help centre
        </Link>
      </div>
      {children}
    </div>
  );
}
