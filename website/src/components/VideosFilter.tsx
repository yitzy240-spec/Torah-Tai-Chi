"use client";

import { useState } from "react";
import Link from "next/link";
import { PLACEHOLDER_THUMB_URL as PLACEHOLDER_THUMB } from "@/lib/storage-url";

interface ParshaItem {
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  thumbUrl?: string | null;
  isCurrentWeek?: boolean;
}

interface VideosFilterProps {
  parshiot: ParshaItem[];
}

const BOOKS = ["All", "Bereishit", "Shemot", "Vayikra", "Bamidbar", "Devarim"];

const BOOK_NORMALIZE: Record<string, string> = {
  Bereishit: "Bereishit",
  Shemot: "Shemot",
  Vayikra: "Vayikra",
  Bamidbar: "Bamidbar",
  Devarim: "Devarim",
  // Legacy English aliases — normalise DB rows that still carry the English
  // book name like "Bereishit (Genesis)" or just "Genesis".
  Genesis: "Bereishit",
  Exodus: "Shemot",
  Leviticus: "Vayikra",
  Numbers: "Bamidbar",
  Deuteronomy: "Devarim",
};

/** Normalise messy book strings like "Bereishit (Genesis)" or "Vayikra (Leviticus)"
 *  down to the Hebrew book name for filter matching. */
function normaliseBook(book: string): string {
  const clean = book.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return BOOK_NORMALIZE[clean] ?? clean;
}

export default function VideosFilter({ parshiot }: VideosFilterProps) {
  const [active, setActive] = useState("All");

  const filtered =
    active === "All"
      ? parshiot
      : parshiot.filter((p) => normaliseBook(p.book) === active);

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
                {/* Duration intentionally hidden on the website grid —
                    every card showed the same "~45s" stamp which looked
                    like a fake timestamp on top of the placeholder thumb. */}
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
