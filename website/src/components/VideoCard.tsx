import Link from "next/link";
import { PLACEHOLDER_THUMB_URL as PLACEHOLDER_THUMB } from "@/lib/storage-url";

interface ParshaCardData {
  name: string;
  slug: string;
  bookShortName: string;
  hebrewName: string;
  date: string;
  /** Optional duration label. Hidden by default — uniform "~45s" across
   *  every parsha was confusing readers (looked like a real timestamp on
   *  the placeholder card). Pass when the duration is genuinely useful. */
  durationLabel?: string;
}

interface VideoCardProps {
  parsha: ParshaCardData;
  /** Feature B: real thumbnail URL from Supabase storage, or undefined → brand placeholder */
  thumbUrl?: string | null;
  /** Feature A: highlight this card as the current week */
  isCurrentWeek?: boolean;
}

export default function VideoCard({ parsha, thumbUrl, isCurrentWeek }: VideoCardProps) {
  return (
    <Link href={`/videos/${parsha.slug}`} className="v-card" style={{ position: "relative" }}>
      {isCurrentWeek && (
        <span
          style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            zIndex: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "var(--ff-body)",
            fontSize: "10.5px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#fff",
            background: "var(--cedar-600, #8B4513)",
            borderRadius: "999px",
            padding: "3px 10px",
          }}
        >
          🌿 This week
        </span>
      )}
      <div className="thumb" style={{ position: "relative", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl ?? PLACEHOLDER_THUMB}
          alt={`${parsha.name} — Torah Tai Chi weekly teaching`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
          }}
        />
        {parsha.durationLabel && (
          <span className="dur" style={{ position: "relative", zIndex: 1 }}>{parsha.durationLabel}</span>
        )}
      </div>
      <div className="v-heb" lang="he" dir="rtl">{parsha.hebrewName}</div>
      <div className="v-name">{parsha.name}</div>
      <div className="v-book">{parsha.bookShortName} &middot; {parsha.date}</div>
    </Link>
  );
}
