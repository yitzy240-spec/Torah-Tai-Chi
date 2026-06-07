'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KieBalance } from './kie-balance';

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
  { href: '/admin/messages', label: 'Messages',   meta: '' },
  { href: '/help',          label: 'Help',         meta: '' },
];

// The four destinations that get a primary slot in the mobile bottom tab bar.
// The fifth slot is a "More" button that opens a sheet with everything else.
// Keep this to four so the tab bar stays in the thumb zone and uncramped; the
// More sheet is derived from NAV_ITEMS below, so adding a NAV_ITEM is enough to
// make it reachable on mobile — no second list to keep in sync.
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
    href: '/compose',
    label: 'Compose',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
      </svg>
    ),
  },
];

// Source of truth for the mobile "More" sheet: every nav destination that
// isn't already a primary tab. Derived so the two lists can't drift.
const MOBILE_TAB_HREFS = new Set(MOBILE_ITEMS.map((i) => i.href));
const MORE_ITEMS = NAV_ITEMS.filter((i) => !MOBILE_TAB_HREFS.has(i.href));

const MoreIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
  </svg>
);

export function SidebarNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // The "More" tab reads as active whenever the current route lives behind it.
  const moreActive = MORE_ITEMS.some((item) => isActive(item.href));

  // While the sheet is open: close on Esc, and lock background scroll.
  // (Selecting a link closes the sheet via its own onClick — no route effect.)
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [moreOpen]);

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
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ width: '24px', height: '1px', background: 'var(--cedar-300)' }} />
          <KieBalance />
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontSize: '11.5px',
              fontStyle: 'italic',
              color: 'var(--ink-500)',
              lineHeight: 1.5,
              fontVariationSettings: '"opsz" 14, "SOFT" 70',
            }}
          >
            <div>Root before you rise.<br />The craft compounds.</div>
          </div>
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

        {/* Fifth slot: opens the More sheet with every other destination. */}
        <button
          type="button"
          aria-label="More"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-sheet"
          onClick={() => setMoreOpen((v) => !v)}
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
            color: moreActive || moreOpen ? 'var(--ink-900)' : 'var(--ink-400)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderRadius: 'var(--r-md)',
            font: 'inherit',
          }}
        >
          <span style={{ width: '20px', height: '20px', color: moreActive || moreOpen ? 'var(--navy-700)' : undefined }}>
            {MoreIcon}
          </span>
          More
        </button>
      </nav>

      {/* Mobile "More" sheet — exposes the destinations that don't fit the tab
          bar. Visibility is mobile-only because the only trigger (the More
          button) lives inside .tabbar-mobile, which is hidden on desktop. */}
      <div
        className={`more-sheet-scrim${moreOpen ? ' open' : ''}`}
        onClick={() => setMoreOpen(false)}
        aria-hidden={!moreOpen}
      />
      <aside
        id="mobile-more-sheet"
        className={`more-sheet${moreOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        aria-hidden={!moreOpen}
      >
        <div className="more-sheet-handle" aria-hidden="true" />
        <div className="more-sheet-header">
          <span className="more-sheet-title">More</span>
          <button
            type="button"
            className="more-sheet-close"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <div className="more-sheet-links">
          {MORE_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`more-sheet-link${active ? ' active' : ''}`}
                onClick={() => setMoreOpen(false)}
              >
                <span>{item.label}</span>
                {item.meta && <span className="more-sheet-meta">{item.meta}</span>}
              </Link>
            );
          })}
        </div>
      </aside>
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
