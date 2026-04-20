"use client";

import { useState } from "react";
import Link from "next/link";

const PLACEHOLDER_THUMB =
  "https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/videos/placeholders/video_placeholder.png";

interface ParshaItem {
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  durationLabel: string;
  thumbUrl?: string | null;
  isCurrentWeek?: boolean;
}

interface VideosFilterProps {
  parshiot: ParshaItem[];
}

const BOOKS = ["All", "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];

const BOOK_NORMALIZE: Record<string, string> = {
  Bereishit: "Genesis",
  Shemot: "Exodus",
  Vayikra: "Leviticus",
  Bamidbar: "Numbers",
  Devarim: "Deuteronomy",
  Genesis: "Genesis",
  Exodus: "Exodus",
  Leviticus: "Leviticus",
  Numbers: "Numbers",
  Deuteronomy: "Deuteronomy",
};

export default function VideosFilter({ parshiot }: VideosFilterProps) {
  const [active, setActive] = useState("All");

  const filtered =
    active === "All"
      ? parshiot
      : parshiot.filter((p) => (BOOK_NORMALIZE[p.book] ?? p.book) === active);

  return (
    <>
      <div className="filter-bar">
        {BOOKS.map((book) => (
          <button
            key={book}
            className={`filter-pill${active === book ? " active" : ""}`}
            onClick={() => setActive(book)}
          >
            {book}
          </button>
        ))}
      </div>

      <section className="video-section">
        <div className="video-grid stagger">
          {filtered.map((p) => (
            <Link key={p.slug} href={`/videos/${p.slug}`} className="v-card" style={{ position: "relative" }}>
              {/* Feature A: "This week" pill */}
              {p.isCurrentWeek && (
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
                {/* Feature B: real or placeholder thumbnail */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbUrl ?? PLACEHOLDER_THUMB}
                  alt=""
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: "inherit",
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_THUMB;
                  }}
                />
                <span className="dur" style={{ position: "relative", zIndex: 1 }}>{p.durationLabel}</span>
              </div>
              <div className="v-heb" lang="he" dir="rtl">
                {p.hebrewName}
              </div>
              <div className="v-name">{p.name}</div>
              <div className="v-book">
                {BOOK_NORMALIZE[p.book] ?? p.book}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
