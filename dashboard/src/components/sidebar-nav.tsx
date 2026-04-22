'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/',              label: 'Today',        meta: 'now' },
  { href: '/calendar',      label: 'Calendar',     meta: '4 ahead' },
  { href: '/videos',        label: 'Videos',       meta: '' },
  { href: '/parshiot',      label: 'Parshiot',     meta: '54' },
  { href: '/compose',       label: 'Compose',      meta: '' },
  { href: '/articles',      label: 'Articles',     meta: '' },
  { href: '/site-content',  label: 'Site content', meta: '' },
  { href: '/channels',      label: 'Channels',     meta: '4 / 5' },
  { href: '/analytics',     label: 'Analytics',    meta: '' },
  { href: '/settings',      label: 'Settings',     meta: '' },
  { href: '/settings/seo', label: 'SEO defaults', meta: '' },
  { href: '/admin/events', label: 'Diagnostics',  meta: '' },
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
          overflowY: 'auto',
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

      {/* Mobile Bottom Tab Bar — visibility + grid layout owned by CSS so
          display:none on desktop isn't clobbered by an inline display:grid. */}
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
  // Photo-realistic logo (public/logo.png) — one source of truth shared
  // with the favicon, OG card, and website Brand component.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Torah Tai Chi"
      width={36}
      height={36}
      style={{ width: '36px', height: '36px', flexShrink: 0, display: 'block' }}
    />
  );
}
