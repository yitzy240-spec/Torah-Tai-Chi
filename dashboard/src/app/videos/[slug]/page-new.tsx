// dashboard/src/app/videos/[slug]/page-new.tsx
//
// Stub for the redesigned video detail page (spec §3 — 4-state architecture).
// This file is populated in subsequent milestones (M2 shared helpers, M3 shell,
// M4-M7 phases). It is imported by the dispatcher (page.tsx) when
// settings.video_page_v2 is true or ?v2=1 is set.

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VideoDetailPageNew({ params }: PageProps) {
  const { slug } = await params;
  return (
    <div style={{ padding: 24 }}>
      <h1>New video page (work in progress)</h1>
      <p>Parsha slug: {slug}</p>
    </div>
  );
}
