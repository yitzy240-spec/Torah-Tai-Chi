'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/',              label: 'Today',        meta: 'now' },
  { href: '/calendar',      label: 'Calendar',     meta: '4 ahead' },
  { href: '/videos',        label: 'Videos',       meta: '52' },
  { href: '/articles',      label: 'Articles',     meta: '' },
  { href: '/site-content',  label: 'Site content', meta: '' },
  { href: '/channels',      label: 'Channels',     meta: '4 / 5' },
  { href: '/analytics',     label: 'Analytics',    meta: '' },
  { href: '/settings',      label: 'Settings',     meta: '' },
  { href: '/help',          label: 'Help',         meta: '' },
];

const MOBILE_ITEMS = [
  {
    href: '/',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
      </svg>
    ),
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>
      </svg>
    ),
  },
  {
    href: '/videos',
    label: 'Videos',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>
      </svg>
    ),
  },
  {
    href: '/channels',
    label: 'Channels',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0z"/>
        <path d="M4 12h16M12 4c2 2.5 3 5 3 8s-1 5.5-3 8c-2-2.5-3-5-3-8s1-5.5 3-8z"/>
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>
      </svg>
    ),
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        style={{
          borderRight: '1px solid var(--ink-100)',
          padding: '30px 20px 24px 28px',
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 100%), var(--linen-50)',
        }}
        className="sidebar-desktop"
      >
        {/* Brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '16px',
            letterSpacing: '-0.003em',
            color: 'var(--ink-900)',
          }}
        >
          <BrandMark />
          <span>Torah&nbsp;Tai&nbsp;Chi</span>
        </div>

        {/* Nav */}
        <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-md)',
                  fontSize: '14px',
                  color: active ? 'var(--linen-50)' : 'var(--ink-700)',
                  textDecoration: 'none',
                  background: active ? 'var(--navy-800)' : 'transparent',
                  transition: 'background var(--trans), color var(--trans)',
                }}
                className={active ? '' : 'sidebar-nav-link'}
              >
                {item.label}
                {item.meta && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: active ? 'var(--navy-300)' : 'var(--ink-300)',
                      fontVariantNumeric: 'tabular-nums',
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                    }}
                  >
                    {item.meta}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer wisdom */}
        <div
          style={{
            marginTop: 'auto',
            fontFamily: 'var(--ff-display)',
            fontSize: '11.5px',
            fontStyle: 'italic',
            color: 'var(--ink-500)',
            lineHeight: 1.5,
            fontVariationSettings: '"opsz" 14, "SOFT" 70',
          }}
        >
          <div style={{ width: '24px', height: '1px', background: 'var(--cedar-300)', marginBottom: '12px' }} />
          <div>Root before you rise.<br />The craft compounds.</div>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Primary"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
          background: 'rgba(250,244,232,.92)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderTop: '1px solid var(--ink-100)',
          padding: '8px 10px 14px',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '4px',
        }}
        className="tabbar-mobile"
      >
        {MOBILE_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                padding: '6px',
                minHeight: '48px',
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: active ? 'var(--ink-900)' : 'var(--ink-400)',
                textDecoration: 'none',
                borderRadius: 'var(--r-md)',
              }}
            >
              <span style={{ width: '20px', height: '20px', color: active ? 'var(--navy-700)' : undefined }}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      style={{ width: '36px', height: '36px', flexShrink: 0 }}
    >
      <defs>
        <radialGradient id="cedarWood-sb" cx="35%" cy="30%" r="80%">
          <stop offset="0%"  stopColor="#E3B888"/>
          <stop offset="45%" stopColor="#B8823A"/>
          <stop offset="100%" stopColor="#6A4622"/>
        </radialGradient>
        <radialGradient id="linenLobe-sb" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#FAF4E8"/>
          <stop offset="100%" stopColor="#E9DDC1"/>
        </radialGradient>
        <radialGradient id="navyLobe-sb" cx="60%" cy="60%" r="80%">
          <stop offset="0%" stopColor="#2B3A5C"/>
          <stop offset="100%" stopColor="#131E38"/>
        </radialGradient>
        <path id="arcTop-sb" d="M 18,60 A 42,42 0 0,1 102,60"/>
      </defs>
      <circle cx="60" cy="60" r="42" fill="url(#cedarWood-sb)" stroke="#3D2A14" strokeWidth="0.8"/>
      <circle cx="60" cy="60" r="34" fill="none" stroke="#3D2A14" strokeWidth="0.4" opacity="0.5"/>
      <g transform="translate(60 60)">
        <circle r="28" fill="url(#linenLobe-sb)"/>
        <path d="M 0,-28 A 28,28 0 0,0 0,28 A 14,14 0 0,1 0,0 A 14,14 0 0,0 0,-28 Z" fill="url(#navyLobe-sb)"/>
        <circle cx="0" cy="-14" r="3.2" fill="#FAF4E8"/>
        <circle cx="0" cy="14" r="3.2" fill="#2B3A5C"/>
        <g transform="translate(0,-14) scale(0.55)">
          <polygon points="0,-8 6.93,4 -6.93,4" fill="none" stroke="#9E7A3A" strokeWidth="1.2"/>
          <polygon points="0,8 6.93,-4 -6.93,-4" fill="none" stroke="#9E7A3A" strokeWidth="1.2"/>
        </g>
      </g>
      <text fontFamily="Fraunces, serif" fontSize="9" fontWeight="600" letterSpacing="3" fill="#3D2A14">
        <textPath href="#arcTop-sb" startOffset="50%" textAnchor="middle">TORAH</textPath>
      </text>
      <text x="60" y="108" fontFamily="Fraunces, serif" fontSize="8" fontWeight="600" letterSpacing="3" fill="#3D2A14" textAnchor="middle">TAI CHI</text>
    </svg>
  );
}
