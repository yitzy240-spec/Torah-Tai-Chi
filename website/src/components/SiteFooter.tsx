import Link from "next/link";
import Brand from "./Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon, FacebookIcon } from "./SocialIcons";
import { getSiteContent } from "@/lib/site-content";

export default async function SiteFooter() {
  const c = await getSiteContent();
  const showBook = c["book.visible"] === "true";
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand-block">
          <Link href="/" className="footer-brand-link" aria-label="Torah Tai Chi home">
            <Brand size={28} />
            <span className="footer-brand-name">Torah Tai Chi</span>
          </Link>
          <p className="footer-tagline">
            Where ancient wisdom meets the body. A weekly practice, in under a minute.
          </p>
        </div>

        <nav className="footer-nav" aria-label="Footer">
          <span className="footer-nav-title">Explore</span>
          <Link href="/">Home</Link>
          <Link href="/videos">Videos</Link>
          <Link href="/articles">Articles</Link>
          {showBook && <Link href="/book">Book</Link>}
          <Link href="/about">About</Link>
        </nav>

        <div className="footer-connect">
          <span className="footer-nav-title">Connect</span>
          <a href="mailto:info@torahtaichi.com" className="footer-contact-link">
            info@torahtaichi.com
          </a>
          <div className="footer-socials">
            <a href="https://tiktok.com/@torahtaichi" aria-label="TikTok" target="_blank" rel="noopener noreferrer">
              <TikTokIcon />
            </a>
            <a href="https://youtube.com/@torahtaichi" aria-label="YouTube" target="_blank" rel="noopener noreferrer">
              <YouTubeIcon />
            </a>
            <a href="https://instagram.com/torahtaichi" aria-label="Instagram" target="_blank" rel="noopener noreferrer">
              <InstagramIcon />
            </a>
            <a href="https://facebook.com/torahtaichi" aria-label="Facebook" target="_blank" rel="noopener noreferrer">
              <FacebookIcon />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-copyright">{c["footer.copyright"]}</div>
        <div className="footer-legal">
          <Link href="/about">About</Link>
          <a href="mailto:info@torahtaichi.com">Contact</a>
        </div>
      </div>
    </footer>
  );
}
