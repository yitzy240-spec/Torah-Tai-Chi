import type { Metadata } from "next";
import Brand from "@/components/Brand";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Torah Tai Chi — questions, collaborations, or just to say hello.",
  openGraph: {
    title: "Contact · Torah Tai Chi",
    description:
      "Get in touch with Torah Tai Chi — questions, collaborations, or just to say hello.",
    type: "website",
    url: "https://torahtaichi.com/contact",
    siteName: "Torah Tai Chi",
    images: [{ url: "/og/default.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact · Torah Tai Chi",
    description:
      "Get in touch with Torah Tai Chi — questions, collaborations, or just to say hello.",
  },
};

export default function ContactPage() {
  return (
    <>
      <main className="about-wrap stagger">
        <div className="about-kicker">
          <span className="bar"></span>
          Get in touch
        </div>
        <h1>
          Say <em>hello</em>
        </h1>
        <p className="about-deck">
          Questions, collaborations, or just to say hi — we read
          everything that lands here.
        </p>

        <ContactForm />

        <p
          style={{
            fontFamily: "var(--ff-reading)",
            fontStyle: "italic",
            fontSize: "14px",
            color: "var(--ink-400)",
            marginTop: "32px",
          }}
        >
          Or email us directly at{" "}
          <a
            href="mailto:info@torahtaichi.com"
            style={{ color: "var(--cedar-600)" }}
          >
            info@torahtaichi.com
          </a>
          .
        </p>
      </main>

      <div className="bottom-mark">
        <Brand size={72} />
      </div>
    </>
  );
}
