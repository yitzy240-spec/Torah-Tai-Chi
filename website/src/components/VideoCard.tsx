import Link from "next/link";

interface ParshaCardData {
  name: string;
  slug: string;
  bookShortName: string;
  hebrewName: string;
  date: string;
  durationLabel: string;
}

interface VideoCardProps {
  parsha: ParshaCardData;
}

export default function VideoCard({ parsha }: VideoCardProps) {
  return (
    <Link href={`/videos/${parsha.slug}`} className="v-card">
      <div className="thumb">
        <span className="dur">{parsha.durationLabel}</span>
      </div>
      <div className="v-heb" lang="he" dir="rtl">{parsha.hebrewName}</div>
      <div className="v-name">{parsha.name}</div>
      <div className="v-book">{parsha.bookShortName} &middot; {parsha.date}</div>
    </Link>
  );
}
