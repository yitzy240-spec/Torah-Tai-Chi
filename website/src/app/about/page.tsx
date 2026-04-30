import type { Metadata } from "next";
import Link from "next/link";
import Brand from "@/components/Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon, FacebookIcon } from "@/components/SocialIcons";
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
          About the practice
        </div>
        <h1>{c['about.title']}</h1>
        <p className="about-deck">{c['about.subtitle']}</p>

        <aside className="about-byline" aria-label="About this practice">
          <div className="about-byline-avatar" aria-hidden="true">
            <Brand size={44} />
          </div>
          <div className="about-byline-text">
            <span className="about-byline-name">A weekly teaching practice</span>
            <span className="about-byline-meta">
              Each week we pair a teaching from Torah with a movement from tai
              chi, and let the two read each other. Sometimes the source is the
              parsha, sometimes a holiday, sometimes an idea worth turning over.
              No lecture. No performance. Just a body, a text, and a few minutes
              of attention.
            </span>
          </div>
        </aside>

        <section className="about-section">
          <h2>What Torah Tai Chi is</h2>
          {paras(c['about.what_is']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>Why the body</h2>
          {paras(c['about.why_body']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>How it arrives</h2>
          {paras(c['about.how_arrives']).map((p, i) => <p key={i}>{p}</p>)}
        </section>

        <section className="about-section">
          <h2>Where to find us</h2>
          <ul className="social-list">
            <li>
              <a
                href="https://tiktok.com/@torahtaichi"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="si">
                  <TikTokIcon />
                </span>
                <span className="sn">TikTok</span>
                <span className="sh">@torahtaichi</span>
              </a>
            </li>
            <li>
              <a
                href="https://youtube.com/@torahtaichi"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="si">
                  <YouTubeIcon />
                </span>
                <span className="sn">YouTube</span>
                <span className="sh">@torahtaichi</span>
              </a>
            </li>
            <li>
              <a
                href="https://instagram.com/torahtaichi"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="si">
                  <InstagramIcon />
                </span>
                <span className="sn">Instagram</span>
                <span className="sh">@torahtaichi</span>
              </a>
            </li>
            <li>
              <a
                href="https://facebook.com/torahtaichi"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="si">
                  <FacebookIcon />
                </span>
                <span className="sn">Facebook</span>
                <span className="sh">/torahtaichi</span>
              </a>
            </li>
          </ul>
        </section>

        {/* Next-step CTAs so readers don't hit a dead end */}
        <section className="about-next">
          <h2 className="about-next-title">Keep going</h2>
          <p className="about-next-deck">
            The practice lives in the weekly teachings. Start there.
          </p>
          <div className="about-next-ctas">
            <Link href="/videos" className="btn btn-primary">
              Watch this week&apos;s teaching
              <span aria-hidden="true" className="btn-arrow">→</span>
            </Link>
            <Link href="/articles" className="hero-cta-link">
              Read the writings
            </Link>
            <a href="mailto:info@torahtaichi.com" className="hero-cta-link">
              Get in touch
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
