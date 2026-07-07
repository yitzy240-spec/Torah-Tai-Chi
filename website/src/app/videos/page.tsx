import type { Metadata } from "next";
import { getAllParshiot } from "@/lib/parshiot";
import { getThisWeekParsha } from "@/lib/hebcal";
import { combinedParshaName } from "@/lib/parsha-display";
import VideosFilter from "@/components/VideosFilter";
import { getSiteContent } from "@/lib/site-content";

// ISR: revalidate every 60 s
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Teachings",
  description:
    "Fifty-four parshiot. A year of teachings where Torah wisdom meets the internal arts.",
  alternates: {
    canonical: "https://torahtaichi.com/videos",
  },
  openGraph: {
    title: "Teachings · Torah Tai Chi",
    description:
      "Fifty-four parshiot. A year of teachings where Torah wisdom meets the internal arts.",
    type: "website",
    url: "https://torahtaichi.com/videos",
    siteName: "Torah Tai Chi",
    images: [{ url: "/og/default.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teachings · Torah Tai Chi",
    description:
      "Fifty-four parshiot. A year of teachings where Torah wisdom meets the internal arts.",
  },
};

export default async function VideosPage() {
  let parshiot: Awaited<ReturnType<typeof getAllParshiot>> = [];
  try {
    parshiot = await getAllParshiot();
  } catch {
    parshiot = [];
  }

  const content = await getSiteContent();

  // Feature A: mark which card is current week
  const hebcalParsha = await getThisWeekParsha();
  const currentWeekSlug = hebcalParsha?.slug ?? null;

  const items = parshiot.map((p) => ({
    // Combined name on double-parsha weeks (e.g. "Matot-Masei"); plain
    // otherwise. Partner rows that ARE merged in still appear as their own
    // catalog card with their plain name (only the lead gets the combined
    // label), so nothing disappears from the grid.
    name: combinedParshaName(p, parshiot),
    slug: p.slug,
    book: p.book,
    hebrewName: p.hebrewName,
    thumbUrl: p.thumbUrl ?? null,
    isCurrentWeek: p.slug === currentWeekSlug,
    videoPublishedAt: p.videoPublishedAt ?? null,
    kind: p.kind,
  }));

  return (
    <>
      <header className="page-header page-header--compact stagger">
        <div className="page-kicker">{content['videos.kicker']}</div>
        <h1>{content['videos.title']}</h1>
        <p className="page-subtitle">
          <em>{content['videos.subtitle']}</em>
        </p>
      </header>

      <VideosFilter parshiot={items} />
    </>
  );
}
