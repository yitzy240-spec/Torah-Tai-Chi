import type { Metadata } from "next";
import { getAllParshiot } from "@/lib/parshiot";
import { getThisWeekParsha } from "@/lib/hebcal";
import VideosFilter from "@/components/VideosFilter";

export const metadata: Metadata = {
  title: "Videos",
  description: "Browse every parsha teaching. 52 weeks of Torah wisdom meeting the body.",
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
    durationLabel: "0:45",
    thumbUrl: p.thumbUrl ?? null,
    isCurrentWeek: p.slug === currentWeekSlug,
  }));

  return (
    <>
      <header className="page-header stagger">
        <div className="page-kicker">THE TEACHINGS</div>
        <h1>The weekly teachings</h1>
        <p className="page-subtitle">
          <em>Fifty-two parshiot. Fifty-two meetings of tradition and breath.</em>
        </p>
      </header>

      <VideosFilter parshiot={items} />
    </>
  );
}
