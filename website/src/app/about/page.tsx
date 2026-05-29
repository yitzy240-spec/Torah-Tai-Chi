import type { Metadata } from "next";
import Link from "next/link";
import Brand from "@/components/Brand";
import { YouTubeIcon, InstagramIcon, FacebookIcon, XIcon } from "@/components/SocialIcons";
import { getSiteContent } from "@/lib/site-content";

// ISR: revalidate every 60 s
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  let description = "Torah Tai Chi is a weekly practice of meeting two traditions in one body.";
  try {
    const c = await getSiteContent();
    if (c["about.subtitle"]) description = c["about.subtitle"];
  } catch {
    // use default
  }
  return {
    title: "About",
    description,
    openGraph: {
      title: "About · Torah Tai Chi",
      description,
      type: "website",
      url: "https://torahtaichi.com/about",
      siteName: "Torah Tai Chi",
      images: [{ url: "/og/default.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "About · Torah Tai Chi",
      description,
    },
  };
}

function paras(text: string): string[] {
  return text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
}

export default async function AboutPage() {
  const c = await getSiteContent();
  return (
    <>
      <main className="about-wrap stagger">
        <div className="about-kicker">
          <span className="bar"></span>
          {c['about.kicker']}
        </div>
        <h1>{c['about.title']}</h1>
        <p className="about-deck">{c['about.subtitle']}</p>

        <aside className="about-byline" aria-label="About this practice">
          <div className="about-byline-avatar" aria-hidden="true">
            <Brand size={44} />
          </div>
          <div className="about-byline-text">
            <span className="about-byline-name">{c['about.byline.name']}</span>
            <span className="about-byline-meta">{c['about.byline.body']}</span>
          </div>
        </aside>

        <section className="about-section">
          <h2>{c['about.section.what_is.heading']}</h2>
          {paras(c['about.what_is']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>{c['about.section.why_body.heading']}</h2>
          {paras(c['about.why_body']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>{c['about.section.how_arrives.heading']}</h2>
          {paras(c['about.how_arrives']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>{c['about.section.where_to_find.heading']}</h2>
          <ul className="social-list">
            <li>
              <a href={c['social.url.youtube']} target="_blank" rel="noopener noreferrer">
                <span className="si"><YouTubeIcon /></span>
                <span className="sn">YouTube</span>
                <span className="sh">{c['social.handle.youtube']}</span>
              </a>
            </li>
            <li>
              <a href={c['social.url.instagram']} target="_blank" rel="noopener noreferrer">
                <span className="si"><InstagramIcon /></span>
                <span className="sn">Instagram</span>
                <span className="sh">{c['social.handle.instagram']}</span>
              </a>
            </li>
            <li>
              <a href={c['social.url.facebook']} target="_blank" rel="noopener noreferrer">
                <span className="si"><FacebookIcon /></span>
                <span className="sn">Facebook</span>
                <span className="sh">{c['social.handle.facebook']}</span>
              </a>
            </li>
            <li>
              <a href={c['social.url.x']} target="_blank" rel="noopener noreferrer">
                <span className="si"><XIcon /></span>
                <span className="sn">X</span>
                <span className="sh">{c['social.handle.x']}</span>
              </a>
            </li>
          </ul>
        </section>

        {/* Next-step CTAs so readers don't hit a dead end */}
        <section className="about-next">
          <h2 className="about-next-title">{c['about.next.heading']}</h2>
          <p className="about-next-deck">{c['about.next.deck']}</p>
          <div className="about-next-ctas">
            <Link href="/videos" className="btn btn-primary">
              {c['about.next.cta_videos']}
              <span aria-hidden="true" className="btn-arrow">→</span>
            </Link>
            <Link href="/articles" className="hero-cta-link">
              {c['about.next.cta_articles']}
            </Link>
            <a href={`mailto:${c['footer.contact_email']}`} className="hero-cta-link">
              {c['about.next.cta_contact']}
            </a>
          </div>
        </section>
      </main>

      <div className="bottom-mark">
        <Brand size={72} />
      </div>
    </>
  );
}
