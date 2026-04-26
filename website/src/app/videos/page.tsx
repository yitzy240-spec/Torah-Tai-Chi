import type { Metadata } from "next";
import { getAllParshiot } from "@/lib/parshiot";
import { getThisWeekParsha } from "@/lib/hebcal";
import VideosFilter from "@/components/VideosFilter";

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

  // Feature A: mark which card is current week
  const hebcalParsha = await getThisWeekParsha();
  const currentWeekSlug = hebcalParsha?.slug ?? null;

  const items = parshiot.map((p) => ({
    name: p.name,
    slug: p.slug,
    book: p.book,
    hebrewName: p.hebrewName,
    thumbUrl: p.thumbUrl ?? null,
    isCurrentWeek: p.slug === currentWeekSlug,
  }));

  return (
    <>
      <header className="page-header stagger">
        <div className="page-kicker">THE TEACHINGS</div>
        <h1>The weekly teachings</h1>
        <p className="page-subtitle">
          <em>Fifty-four parshiot. One cycle through the Torah, told through the body.</em>
        </p>
      </header>

      <VideosFilter parshiot={items} />
    </>
  );
}
