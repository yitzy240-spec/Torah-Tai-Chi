import type { Metadata } from "next";
import Brand from "@/components/Brand";
import { TikTokIcon, YouTubeIcon, InstagramIcon, FacebookIcon } from "@/components/SocialIcons";

export const metadata: Metadata = {
  title: "About",
  description: "Torah Tai Chi is a weekly practice of meeting two traditions in one body.",
};

export default function AboutPage() {
  return (
    <>
      <main className="about-wrap stagger">
        <div className="about-kicker">
          <span className="bar"></span>
          About the practice
        </div>
        <h1>
          Where two traditions <em>meet the body.</em>
        </h1>
        <p className="about-deck">A practice, not a product.</p>

        <section className="about-section">
          <h2>What Torah Tai Chi is</h2>
          <p>
            Torah Tai Chi is a weekly practice of meeting two traditions in one body. Each week&apos;s
            parsha carries a teaching; each Chinese internal-arts principle carries a mirror image of
            that teaching in the language of rooting, yielding, and release.
          </p>
          <p>
            The weekly parsha is not read as a lecture. It is read through the spine.{" "}
            <span className="ch">Song 松</span> becomes a frame for understanding{" "}
            <em>anavah</em>.{" "}
            <span className="ch">Zhan zhuang</span> becomes a frame for understanding{" "}
            <em>amidah</em>. Two old vocabularies, pointing at the same quiet center.
          </p>
        </section>

        <section className="about-section">
          <h2>Why the body</h2>
          <p>
            The body knows before the mind does. Torah Tai Chi reads the parsha through the spine,
            the breath, the soft-jaw moment before reaction. The traditions that have lasted longest
            agree on this, even when they disagree about almost everything else: wisdom lives below
            the neck.
          </p>
          <p>
            The texts are luminous, and they deserve to be studied. But they were written for people
            with bodies — people who stood, who bowed, who walked, who breathed. To meet the text
            only with the mind is to meet half of it. The practice is to bring the other half back.
          </p>
        </section>

        <section className="about-section">
          <h2>How it arrives</h2>
          <p>
            Every week: a short teaching, and a breath to try. The teaching runs under a minute. It
            lands on Friday, in time for Shabbat. It asks nothing of you except your attention for
            the length of one exhale.
          </p>
          <p>
            Occasionally: longer writings for those who want to sit with an idea. Essays, reflections,
            a teaching here and there — published when they are ready, not on a schedule. The short
            video is the weekly heartbeat. The writings are what happens between.
          </p>
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
