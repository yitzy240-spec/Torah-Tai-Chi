'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCustomScript } from '@/app/actions/generate-custom-script';
import { GenerateDialog } from '@/components/generate-dialog';

export interface CarouselScript {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
}

interface ScriptCarouselProps {
  parshaId: string;
  parshaName: string;
  scripts: CarouselScript[];
  /** Optional default tier key pre-selected in the generate dialog. */
  defaultTierKey?: string;
}

// Preferred display order so A lives left, then B, C, A-tight, then any
// custom scripts (newest first), then the idea card at the end.
function sortScripts(scripts: CarouselScript[]): CarouselScript[] {
  const rank = (opt: string) => {
    if (opt === 'A') return 0;
    if (opt === 'B') return 1;
    if (opt === 'C') return 2;
    if (opt === 'A-tight') return 3;
    return 4;
  };
  return [...scripts].sort((a, b) => {
    const ra = rank(a.option);
    const rb = rank(b.option);
    if (ra !== rb) return ra - rb;
    if (a.option.startsWith('custom-') && b.option.startsWith('custom-')) {
      // Custom keys encode timestamps — newer first.
      return b.option.localeCompare(a.option);
    }
    return a.option.localeCompare(b.option);
  });
}

function preview(text: string | null, chars = 300): string {
  if (!text) return '';
  const t = text.trim();
  if (t.length <= chars) return t;
  return t.slice(0, chars).trimEnd() + '…';
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function optionLabel(opt: string): string {
  if (opt.startsWith('custom-')) return 'Custom';
  return opt;
}

export function ScriptCarousel({
  parshaId,
  parshaName,
  scripts,
  defaultTierKey,
}: ScriptCarouselProps) {
  const router = useRouter();
  const ordered = useMemo(() => sortScripts(scripts), [scripts]);
  const totalSlides = ordered.length + 1; // + idea card
  const [index, setIndex] = useState(0);

  // Custom-idea card state
  const [idea, setIdea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const clampedIndex = Math.min(index, totalSlides - 1);
  const isIdeaSlide = clampedIndex === ordered.length;
  const currentScript = isIdeaSlide ? null : ordered[clampedIndex];

  const go = (delta: number) => {
    setError(null);
    setIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return totalSlides - 1;
      if (next >= totalSlides) return 0;
      return next;
    });
  };

  const handleGenerate = () => {
    setError(null);
    const trimmed = idea.trim();
    if (!trimmed) {
      setError('Share your idea first.');
      return;
    }
    startTransition(async () => {
      const result = await generateCustomScript(parshaId, trimmed);
      if (result.error || !result.script) {
        setError(result.error ?? 'Something went wrong.');
        return;
      }
      setIdea('');
      // Refresh the server component so the new script joins the carousel.
      router.refresh();
      // After refresh, land the user on the new custom slide. The new
      // custom row sorts to the first custom position (index ordered.length
      // pre-refresh); after refresh it will be at ordered.length too (same
      // position as the idea card was), so advance to that slot.
      setIndex(ordered.length);
    });
  };

  return (
    <div
      style={{
        padding: '28px 30px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        position: 'relative',
      }}
    >
      {/* Header row: label + counter + arrows */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '14px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <h2
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 500,
              fontSize: '15px',
              color: 'var(--ink-900)',
              margin: 0,
              fontVariationSettings: '"opsz" 18, "SOFT" 30',
            }}
          >
            Script
          </h2>
          <span
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 600,
              fontSize: '10.5px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '3px 9px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              color: 'var(--ink-700)',
              background: isIdeaSlide ? 'var(--cedar-300)' : 'transparent',
            }}
          >
            {isIdeaSlide ? 'Your idea' : optionLabel(currentScript!.option)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowButton direction="left" onClick={() => go(-1)} />
          <span
            style={{
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: '12px',
              color: 'var(--ink-500)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: '44px',
              textAlign: 'center',
            }}
          >
            {clampedIndex + 1} / {totalSlides}
          </span>
          <ArrowButton direction="right" onClick={() => go(1)} />
        </div>
      </div>

      {/* Slide body */}
      {isIdeaSlide ? (
        <IdeaCard
          parshaName={parshaName}
          idea={idea}
          setIdea={setIdea}
          onGenerate={handleGenerate}
          isPending={isPending}
          error={error}
        />
      ) : (
        <ScriptCard
          script={currentScript!}
          parshaId={parshaId}
          parshaName={parshaName}
          defaultTierKey={defaultTierKey}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- subviews

function ScriptCard({
  script,
  parshaId,
  parshaName,
  defaultTierKey,
}: {
  script: CarouselScript;
  parshaId: string;
  parshaName: string;
  defaultTierKey?: string;
}) {
  const words = wordCount(script.draft_text);
  return (
    <div>
      {/* Title */}
      <h3
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '22px',
          lineHeight: 1.2,
          color: 'var(--ink-900)',
          margin: '4px 0 6px 0',
          letterSpacing: '-0.01em',
          fontVariationSettings: '"opsz" 24, "SOFT" 30',
        }}
      >
        {script.title ?? optionLabel(script.option)}
      </h3>

      {/* TLDR (italic display) */}
      {script.tldr && (
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            lineHeight: 1.5,
            margin: '0 0 14px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 60',
          }}
        >
          {script.tldr}
        </p>
      )}

      {/* Word count / option sub-label */}
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-400)',
          margin: '0 0 18px 0',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        {optionLabel(script.option)} · {words} words
      </p>

      {/* Preview text (~300 chars) */}
      <div
        style={{
          fontFamily: 'var(--ff-reading)',
          fontSize: '16px',
          lineHeight: 1.65,
          color: 'var(--ink-800)',
          fontVariationSettings: '"opsz" 18, "SOFT" 30',
          marginBottom: '18px',
        }}
      >
        {script.draft_text ? (
          <p style={{ margin: 0 }}>{preview(script.draft_text, 300)}</p>
        ) : (
          <p style={{ fontStyle: 'italic', color: 'var(--ink-400)', margin: 0 }}>
            No draft text.
          </p>
        )}
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <GenerateDialog
          parshaId={parshaId}
          scriptId={script.id}
          parshaName={parshaName}
          defaultTierKey={defaultTierKey}
        />
        <button
          type="button"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-500)',
            textDecoration: 'underline',
            textDecorationColor: 'var(--ink-200)',
            textUnderlineOffset: '4px',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            transition: 'all var(--trans)',
          }}
        >
          Edit script
        </button>
      </div>
    </div>
  );
}

function IdeaCard({
  parshaName,
  idea,
  setIdea,
  onGenerate,
  isPending,
  error,
}: {
  parshaName: string;
  idea: string;
  setIdea: (v: string) => void;
  onGenerate: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div>
      <h3
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '22px',
          lineHeight: 1.2,
          color: 'var(--ink-900)',
          margin: '4px 0 6px 0',
          letterSpacing: '-0.01em',
          fontVariationSettings: '"opsz" 24, "SOFT" 30',
        }}
      >
        Have an idea for this week&apos;s parsha video?
      </h3>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '14px',
          color: 'var(--ink-500)',
          lineHeight: 1.5,
          margin: '0 0 14px 0',
          fontVariationSettings: '"opsz" 16, "SOFT" 60',
        }}
      >
        Let me know what you&apos;re picturing for {parshaName} and I&apos;ll
        generate a new Rav-Eli-voiced script from it.
      </p>

      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="The angle I want this week is the stillness of shemittah meeting zhan zhuang — the field that rests is the root that feeds…"
        disabled={isPending}
        style={{
          width: '100%',
          minHeight: '110px',
          padding: '14px 16px',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-md)',
          background: 'white',
          fontFamily: 'var(--ff-body)',
          fontSize: '15px',
          color: 'var(--ink-900)',
          resize: 'vertical',
          lineHeight: 1.55,
          outline: 'none',
          boxSizing: 'border-box',
          opacity: isPending ? 0.6 : 1,
        }}
      />

      {error && (
        <p
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--tassel)',
            margin: '10px 0 0 0',
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginTop: '14px',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--ink-400)',
            fontVariationSettings: '"opsz" 14, "SOFT" 60',
          }}
        >
          {isPending
            ? 'Rav Eli is writing…'
            : 'Takes ~15 seconds. The new script joins the carousel.'}
        </span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isPending || !idea.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '11px 22px',
            minHeight: '44px',
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: isPending || !idea.trim() ? 'not-allowed' : 'pointer',
            transition: 'all var(--trans)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
            opacity: isPending || !idea.trim() ? 0.5 : 1,
          }}
        >
          {isPending ? 'Generating…' : 'Generate script'}
        </button>
      </div>
    </div>
  );
}

function ArrowButton({
  direction,
  onClick,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Previous script' : 'Next script'}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '1px solid var(--ink-200)',
        background: 'var(--linen-50)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-700)',
        transition: 'all var(--trans)',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          width: '16px',
          height: '16px',
          transform: direction === 'right' ? 'rotate(180deg)' : undefined,
        }}
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
