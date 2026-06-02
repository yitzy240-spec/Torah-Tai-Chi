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
  /** ISO timestamp the parsha's video was published (videos.created_at).
   *  Drives the "All" tab's reverse-chronological sort — most recently
   *  produced video first (Yonah 2026-06-02). Null when no video yet. */
  videoPublishedAt?: string | null;
  /** 'parsha' for weekly Torah portions, 'holiday' for Shavuot/Pesach/
   *  Sukkot/etc. and ad-hoc special videos. Drives the "Holidays and
   *  Events" filter pill. */
  kind?: 'parsha' | 'holiday';
}

interface VideosFilterProps {
  parshiot: ParshaItem[];
}

// Filter-pill definitions. Each has a Hebrew/primary label and an
// optional English subtitle shown smaller underneath (Yonah 2026-06-02).
// Order matters: "All" first, books in Torah sequence, holidays last.
const FILTER_PILLS: Array<{ key: string; label: string; sub?: string }> = [
  { key: 'All' },
  { key: 'Bereishit', label: 'Bereishit', sub: 'Genesis' },
  { key: 'Shemot',    label: 'Shemot',    sub: 'Exodus' },
  { key: 'Vayikra',   label: 'Vayikra',   sub: 'Leviticus' },
  { key: 'Bamidbar',  label: 'Bamidbar',  sub: 'Numbers' },
  { key: 'Devarim',   label: 'Devarim',   sub: 'Deuteronomy' },
  { key: 'Holidays',  label: 'Holidays and Events' },
].map((p) => ({ ...p, label: p.label ?? p.key }));

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

  // Universal rule: only show parshiot/holidays that ACTUALLY have a
  // video. "Coming soon" cards were noise (Yonah 2026-06-02). The one
  // exception is the upcoming weekly parsha (isCurrentWeek=true) which
  // surfaces in the "All" view even before its video lands so visitors
  // who arrive between renders see what's coming next.
  const hasVideoOrUpcoming = (p: ParshaItem) =>
    Boolean(p.videoPublishedAt) || Boolean(p.isCurrentWeek);

  let filtered: ParshaItem[];
  if (active === 'All') {
    // "All" → published videos newest first (most recent backwards);
    // upcoming-week parsha without a video lands at the very top so
    // visitors see what's next.
    filtered = parshiot.filter(hasVideoOrUpcoming).sort((a, b) => {
      if (a.isCurrentWeek && !a.videoPublishedAt) return -1;
      if (b.isCurrentWeek && !b.videoPublishedAt) return 1;
      const aT = a.videoPublishedAt ?? '';
      const bT = b.videoPublishedAt ?? '';
      return bT.localeCompare(aT);
    });
  } else if (active === 'Holidays') {
    filtered = parshiot.filter(
      (p) => p.kind === 'holiday' && hasVideoOrUpcoming(p),
    );
  } else {
    // A book pill — canonical Torah order, only ones with videos.
    filtered = parshiot.filter(
      (p) => p.kind !== 'holiday'
        && normaliseBook(p.book) === active
        && hasVideoOrUpcoming(p),
    );
  }

  return (
    <>
      <div className="filter-bar">
        {FILTER_PILLS.map((pill) => (
          <button
            key={pill.key}
            className={`filter-pill${active === pill.key ? " active" : ""}${pill.sub ? " filter-pill--stacked" : ""}`}
            onClick={() => setActive(pill.key)}
          >
            <span className="filter-pill-label">{pill.label}</span>
            {pill.sub && (
              <span className="filter-pill-sub">({pill.sub})</span>
            )}
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
