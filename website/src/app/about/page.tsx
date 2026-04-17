import type { Metadata } from "next";
import Brand from "@/components/Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon, FacebookIcon } from "@/components/SocialIcons";
import { getSiteContent } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "About",
  description: "Torah Tai Chi is a weekly practice of meeting two traditions in one body.",
};

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
      </main>

      <div className="bottom-mark">
        <Brand size={72} />
      </div>
    </>
  );
}
