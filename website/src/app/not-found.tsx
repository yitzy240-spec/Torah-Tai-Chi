import Link from "next/link";
import Brand from "@/components/Brand";

export const metadata = {
  title: "Page not found",
  description:
    "The page you were looking for is off the path. Try the weekly teaching, the writings, or head back home.",
};

export default function NotFound() {
  return (
    <main className="nf-wrap stagger">
      <div className="nf-mark" aria-hidden="true">
        <Brand size={72} />
      </div>

      <div className="nf-kicker">
        <span className="bar"></span>
        404 · off the path
      </div>

      <h1 className="nf-title">
        This page is <em>not here.</em>
      </h1>

      <p className="nf-deck">
        Maybe the link broke, maybe the page never existed — either way, there&apos;s nothing
        to root into at this address. Here&apos;s where the practice continues:
      </p>

      <div className="nf-ctas">
        <Link href="/" className="btn btn-primary">
          Go home
          <span aria-hidden="true" className="btn-arrow">→</span>
        </Link>
        <Link href="/videos" className="hero-cta-link">
          Watch this week&apos;s teaching
        </Link>
      </div>

      <section className="nf-suggest">
        <span className="nf-suggest-title">Or try one of these</span>
        <ul className="nf-suggest-list">
          <li>
            <Link href="/videos">
              <span className="nf-suggest-label">Videos</span>
              <span className="nf-suggest-desc">Every parsha in under a minute.</span>
            </Link>
          </li>
          <li>
            <Link href="/articles">
              <span className="nf-suggest-label">Writings</span>
              <span className="nf-suggest-desc">Essays on where wisdom lives in the body.</span>
            </Link>
          </li>
          <li>
            <Link href="/about">
              <span className="nf-suggest-label">About</span>
              <span className="nf-suggest-desc">What Torah Tai Chi is, and why.</span>
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
