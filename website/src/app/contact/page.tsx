import type { Metadata } from "next";
import Brand from "@/components/Brand";
import { ContactForm } from "./contact-form";
import { getSiteContent } from "@/lib/site-content";

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

export default async function ContactPage() {
  const c = await getSiteContent();
  const email = c['footer.contact_email'];
  return (
    <>
      <main className="about-wrap stagger">
        <div className="about-kicker">
          <span className="bar"></span>
          {c['contact.kicker']}
        </div>
        <h1>
          {c['contact.title.before_em']}<em>{c['contact.title.em']}</em>
        </h1>
        <p className="about-deck">{c['contact.deck']}</p>

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
          {c['contact.email_intro']}{" "}
          <a
            href={`mailto:${email}`}
            style={{ color: "var(--cedar-600)" }}
          >
            {email}
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
