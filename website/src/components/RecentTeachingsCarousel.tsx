'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PLACEHOLDER_THUMB_URL as PLACEHOLDER_THUMB } from '@/lib/storage-url';

export interface CarouselCard {
  name: string;
  slug: string;
  hebrewName: string;
  bookShortName: string;
  thumbUrl: string | null;
  isCurrentWeek: boolean;
  /** Short preview shown on the back of the flip — first 1-2 sentences. */
  preview: string;
}

interface Props {
  cards: CarouselCard[];
}

/**
 * Horizontal-scroll carousel of teaching cards. Tapping a card flips it
 * to reveal the script preview + "Play now" CTA. Native scroll-snap
 * drives the swipe on mobile; arrow buttons handle desktop.
 *
 * Each card is its own flip toggle so users can compare adjacent
 * teachings without losing their place in the carousel.
 */
export default function RecentTeachingsCarousel({ cards }: Props) {
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const toggleFlip = useCallback((slug: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows, cards.length]);

  const scrollByDelta = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="rt-carousel" role="region" aria-label="Recent teachings">
      <div className="rt-scroller" ref={scrollerRef}>
        {cards.map((card) => (
          <FlipCard
            key={card.slug}
            card={card}
            flipped={flipped.has(card.slug)}
            onFlip={() => toggleFlip(card.slug)}
          />
        ))}
      </div>
      {canPrev && (
        <button
          type="button"
          className="rt-arrow rt-arrow-prev"
          onClick={() => scrollByDelta(-280)}
          aria-label="Previous teachings"
        >
          ‹
        </button>
      )}
      {canNext && (
        <button
          type="button"
          className="rt-arrow rt-arrow-next"
          onClick={() => scrollByDelta(280)}
          aria-label="More teachings"
        >
          ›
        </button>
      )}
    </div>
  );
}

function FlipCard({
  card,
  flipped,
  onFlip,
}: {
  card: CarouselCard;
  flipped: boolean;
  onFlip: () => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFlip();
    }
  };

  return (
    <div className={`rt-card${flipped ? ' is-flipped' : ''}`}>
      <div className="rt-card-inner">
        {/* FRONT — clickable to flip */}
        <button
          type="button"
          className="rt-face rt-front"
          onClick={onFlip}
          onKeyDown={onKeyDown}
          aria-pressed={flipped}
          aria-label={`${card.name} — tap to read teaching`}
        >
          <div
            className="rt-thumb"
            style={{
              backgroundImage: `url(${card.thumbUrl ?? PLACEHOLDER_THUMB})`,
            }}
          >
            {card.isCurrentWeek && <span className="rt-badge">🌿 This week</span>}
            <span className="rt-tap-hint">Tap to read →</span>
          </div>
          <div className="rt-meta">
            <div className="rt-heb" lang="he" dir="rtl">{card.hebrewName}</div>
            <div className="rt-name">{card.name}</div>
            <div className="rt-book">{card.bookShortName}</div>
          </div>
        </button>

        {/* BACK — script preview + Play CTA. The face itself flips back on
            click, but the Play link stops propagation so it navigates
            cleanly. */}
        <div
          className="rt-face rt-back"
          onClick={onFlip}
          role="button"
          tabIndex={flipped ? 0 : -1}
          onKeyDown={onKeyDown}
          aria-hidden={!flipped}
        >
          <p className="rt-back-preview">{card.preview}</p>
          <Link
            href={`/videos/${card.slug}`}
            className="rt-play-btn"
            onClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play now
          </Link>
          <button
            type="button"
            className="rt-back-flip"
            onClick={(e) => { e.stopPropagation(); onFlip(); }}
          >
            Flip back
          </button>
        </div>
      </div>
    </div>
  );
}
