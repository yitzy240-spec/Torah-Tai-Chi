"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Brand from "./Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon } from "./SocialIcons";

export default function SiteNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        <Brand size={32} />
        <span>Torah Tai Chi</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="nav-links">
          <Link href="/" className={isActive("/") && pathname === "/" ? "active" : ""}>Home</Link>
          <Link href="/videos" className={isActive("/videos") ? "active" : ""}>Videos</Link>
          <Link href="/articles" className={isActive("/articles") ? "active" : ""}>Articles</Link>
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
      </div>
    </nav>
  );
}
