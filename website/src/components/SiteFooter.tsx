import Link from "next/link";
import Brand from "./Brand";
import { YouTubeIcon, InstagramIcon, FacebookIcon, XIcon } from "./SocialIcons";
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
          <p className="footer-tagline">{c['footer.tagline']}</p>
        </div>

        <nav className="footer-nav" aria-label="Footer">
          <span className="footer-nav-title">{c['footer.heading.explore']}</span>
          <Link href="/">Home</Link>
          <Link href="/videos">Videos</Link>
          <Link href="/articles">Articles</Link>
          {showBook && <Link href="/book">Book</Link>}
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>

        <div className="footer-connect">
          <span className="footer-nav-title">{c['footer.heading.connect']}</span>
          <Link href="/contact" className="footer-contact-link">
            {c['footer.label.contact_us']}
          </Link>
          <a href={`mailto:${c['footer.contact_email']}`} className="footer-contact-link">
            {c['footer.contact_email']}
          </a>
          <div className="footer-socials">
            <a href={c['social.url.youtube']} aria-label="YouTube" target="_blank" rel="noopener noreferrer">
              <YouTubeIcon />
            </a>
            <a href={c['social.url.instagram']} aria-label="Instagram" target="_blank" rel="noopener noreferrer">
              <InstagramIcon />
            </a>
            <a href={c['social.url.facebook']} aria-label="Facebook" target="_blank" rel="noopener noreferrer">
              <FacebookIcon />
            </a>
            <a href={c['social.url.x']} aria-label="X" target="_blank" rel="noopener noreferrer">
              <XIcon />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-copyright">{c["footer.copyright"]}</div>
        <div className="footer-legal">
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  );
}
