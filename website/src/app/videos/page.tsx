import type { Metadata } from "next";
import { getAllParshiot } from "@/lib/parshiot";
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

  const items = parshiot.map((p) => ({
    name: p.name,
    slug: p.slug,
    book: p.book,
    hebrewName: p.hebrewName,
    durationLabel: "0:45",
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
