"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "./Brand";
import { FacebookIcon, YouTubeIcon, InstagramIcon, XIcon } from "./SocialIcons";

// Canonical social URLs — source of truth lives in
// website/src/lib/site-content.ts under social.url.*. SiteNav is a
// client component so we don't pull from server-only content here;
// keep these in sync manually. When something needs to change, update
// BOTH this file and site-content.ts (and jsonld.ts).
const SOCIAL_URLS = {
  facebook: "https://www.facebook.com/people/Torah-Tai-Chi/61590370923943/",
  youtube:  "https://www.youtube.com/@TorahTai_Chi",
  instagram:"https://instagram.com/torah_taichi",
  x:        "https://x.com/Torah_TaiChi",
};

interface SiteNavProps {
  showBook?: boolean;
}

export default function SiteNav({ showBook = false }: SiteNavProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Close on Esc; lock body scroll while open
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        <Brand size={52} />
        <span>Torah Tai Chi</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="nav-links">
          <Link href="/" className={isActive("/") && pathname === "/" ? "active" : ""}>Home</Link>
          <Link href="/videos" className={isActive("/videos") ? "active" : ""}>Videos</Link>
          <Link href="/articles" className={isActive("/articles") ? "active" : ""}>Articles</Link>
          {showBook && (
            <Link href="/book" className={isActive("/book") ? "active" : ""}>Book</Link>
          )}
          <Link href="/about" className={isActive("/about") ? "active" : ""}>About</Link>
          <Link href="/contact" className={isActive("/contact") ? "active" : ""}>Contact</Link>
        </div>
        <div className="nav-socials">
          <a href={SOCIAL_URLS.facebook} title="Facebook" target="_blank" rel="noopener noreferrer">
            <FacebookIcon />
          </a>
          <a href={SOCIAL_URLS.youtube} title="YouTube" target="_blank" rel="noopener noreferrer">
            <YouTubeIcon />
          </a>
          <a href={SOCIAL_URLS.instagram} title="Instagram" target="_blank" rel="noopener noreferrer">
            <InstagramIcon />
          </a>
          <a href={SOCIAL_URLS.x} title="X" target="_blank" rel="noopener noreferrer">
            <XIcon />
          </a>
        </div>
        <button
          type="button"
          className="nav-hamburger"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav-drawer"
          onClick={() => setDrawerOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      <div
        className={`nav-drawer-scrim${drawerOpen ? " open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />
      <aside
        id="mobile-nav-drawer"
        className={`nav-drawer${drawerOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        aria-hidden={!drawerOpen}
      >
        <div className="nav-drawer-header">
          <span className="nav-drawer-title">Menu</span>
          <button
            type="button"
            className="nav-drawer-close"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <div className="nav-drawer-links">
          <Link href="/" className={isActive("/") && pathname === "/" ? "active" : ""}>Home</Link>
          <Link href="/videos" className={isActive("/videos") ? "active" : ""}>Videos</Link>
          <Link href="/articles" className={isActive("/articles") ? "active" : ""}>Articles</Link>
          {showBook && (
            <Link href="/book" className={isActive("/book") ? "active" : ""}>Book</Link>
          )}
          <Link href="/about" className={isActive("/about") ? "active" : ""}>About</Link>
          <Link href="/contact" className={isActive("/contact") ? "active" : ""}>Contact</Link>
        </div>
        <div className="nav-drawer-socials">
          <a href={SOCIAL_URLS.facebook} aria-label="Facebook" target="_blank" rel="noopener noreferrer">
            <FacebookIcon />
            <span>Facebook</span>
          </a>
          <a href={SOCIAL_URLS.youtube} aria-label="YouTube" target="_blank" rel="noopener noreferrer">
            <YouTubeIcon />
            <span>YouTube</span>
          </a>
          <a href={SOCIAL_URLS.instagram} aria-label="Instagram" target="_blank" rel="noopener noreferrer">
            <InstagramIcon />
            <span>Instagram</span>
          </a>
          <a href={SOCIAL_URLS.x} aria-label="X" target="_blank" rel="noopener noreferrer">
            <XIcon />
            <span>X</span>
          </a>
        </div>
      </aside>
    </nav>
  );
}
