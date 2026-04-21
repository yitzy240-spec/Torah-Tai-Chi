"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "./Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon } from "./SocialIcons";

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
        </div>
        <div className="nav-socials">
          <a href="https://tiktok.com/@torahtaichi" title="TikTok" target="_blank" rel="noopener noreferrer">
            <TikTokIcon />
          </a>
          <a href="https://youtube.com/@torahtaichi" title="YouTube" target="_blank" rel="noopener noreferrer">
            <YouTubeIcon />
          </a>
          <a href="https://instagram.com/torahtaichi" title="Instagram" target="_blank" rel="noopener noreferrer">
            <InstagramIcon />
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
        </div>
        <div className="nav-drawer-socials">
          <a href="https://tiktok.com/@torahtaichi" aria-label="TikTok" target="_blank" rel="noopener noreferrer">
            <TikTokIcon />
            <span>TikTok</span>
          </a>
          <a href="https://youtube.com/@torahtaichi" aria-label="YouTube" target="_blank" rel="noopener noreferrer">
            <YouTubeIcon />
            <span>YouTube</span>
          </a>
          <a href="https://instagram.com/torahtaichi" aria-label="Instagram" target="_blank" rel="noopener noreferrer">
            <InstagramIcon />
            <span>Instagram</span>
          </a>
        </div>
      </aside>
    </nav>
  );
}
