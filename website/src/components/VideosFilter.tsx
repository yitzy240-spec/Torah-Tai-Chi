"use client";

import { useState } from "react";
import Link from "next/link";

interface ParshaItem {
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  durationLabel: string;
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
            <Link key={p.slug} href={`/videos/${p.slug}`} className="v-card">
              <div className="thumb">
                <span className="dur">{p.durationLabel}</span>
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
