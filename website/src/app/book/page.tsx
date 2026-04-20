import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContent } from "@/lib/site-content";
import Brand from "@/components/Brand";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getSiteContent();
  if (c["book.visible"] !== "true") return {};
  return {
    title: `${c["book.title"]} — The Book`,
    description: c["book.subtitle"],
    openGraph: {
      title: `${c["book.title"]} — The Book`,
      description: c["book.subtitle"],
      type: "website",
      url: "https://torahtaichi.com/book",
      siteName: "Torah Tai Chi",
      images: [{ url: "/og/default.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${c["book.title"]} — The Book`,
      description: c["book.subtitle"],
    },
  };
}

export default async function BookPage() {
  const c = await getSiteContent();

  if (c["book.visible"] !== "true") {
    notFound();
  }

  const title = c["book.title"] || "Torah Tai Chi";
  const subtitle = c["book.subtitle"] || "";
  const description = c["book.description"] || "";
  const coverUrl = c["book.cover_url"] || "";
  const purchaseUrl = c["book.purchase_url"] || "";
  const ctaLabel = c["book.cta_label"] || "Buy the book";

  const descParagraphs = description.split(/\n\n+/).filter(Boolean);

  return (
    <>
      <header className="page-header stagger">
        <div className="page-kicker">THE BOOK</div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle"><em>{subtitle}</em></p>}
      </header>

      <main className="book-wrap stagger">
        {coverUrl && (
          <div className="book-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverUrl} alt={`${title} book cover`} width={320} height={480} />
          </div>
        )}

        <div className="book-body">
          {descParagraphs.map((para, i) => (
            <p key={i}>{para}</p>
          ))}

          {purchaseUrl ? (
            <a
              href={purchaseUrl}
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginTop: "2rem", display: "inline-block" }}
            >
              {ctaLabel}
            </a>
          ) : (
            <p className="book-coming-soon" style={{ marginTop: "2rem", fontStyle: "italic", color: "var(--ink-400)" }}>
              Available soon.
            </p>
          )}
        </div>
      </main>

      <div className="bottom-mark">
        <Brand size={72} />
      </div>
    </>
  );
}
