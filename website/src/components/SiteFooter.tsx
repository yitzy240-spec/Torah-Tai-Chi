import Link from "next/link";
import { TikTokIcon, YouTubeIcon, InstagramIcon, FacebookIcon } from "./SocialIcons";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">&copy; 2026 Torah Tai Chi &middot; torahtaichi.com</div>
      <div className="footer-links">
        <Link href="/videos">Videos</Link>
        <Link href="/articles">Articles</Link>
        <Link href="/about">About</Link>
      </div>
      <div className="footer-socials">
        <a href="https://tiktok.com/@torahtaichi" title="TikTok" target="_blank" rel="noopener noreferrer">
          <TikTokIcon />
        </a>
        <a href="https://youtube.com/@torahtaichi" title="YouTube" target="_blank" rel="noopener noreferrer">
          <YouTubeIcon />
        </a>
        <a href="https://instagram.com/torahtaichi" title="Instagram" target="_blank" rel="noopener noreferrer">
          <InstagramIcon />
        </a>
        <a href="https://facebook.com/torahtaichi" title="Facebook" target="_blank" rel="noopener noreferrer">
          <FacebookIcon />
        </a>
      </div>
    </footer>
  );
}
