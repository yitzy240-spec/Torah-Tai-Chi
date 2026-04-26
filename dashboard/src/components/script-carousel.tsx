'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCustomScript } from '@/app/actions/generate-custom-script';
import { saveScriptDraft } from '@/app/actions/save-script-draft';
import { GenerateDialog } from '@/components/generate-dialog';
import { TaiChiMovePicker, type TaiChiMove } from '@/components/tai-chi-move-picker';
import { addMoveToScript } from '@/app/actions/add-move-to-script';

export interface CarouselScript {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
  motion_ref_slug: string | null;
  // Set when scripts are merged across a combined-parsha pair so the
  // card can label "From Kedoshim" and routes Approve / Add-move actions
  // to the correct parsha. When unset, the carousel-level parshaId/Slug
  // props are used.
  parsha_id?: string | null;
  parsha_name?: string | null;
  parsha_slug?: string | null;
}

interface ScriptCarouselProps {
  parshaId: string;
  parshaName: string;
  parshaSlug?: string;
  scripts: CarouselScript[];
  /** Optional default tier key pre-selected in the generate dialog. */
  defaultTierKey?: string;
  /** When this Shabbat is a combined-parsha week, the parsha ids that
   *  should both be tagged on any resulting job (primary + partner). When
   *  unset, jobs are recorded against the single host parsha as usual. */
  combinedParshaIds?: string[];
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
  parshaSlug,
  scripts,
  defaultTierKey,
  combinedParshaIds,
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
          parshaSlug={parshaSlug}
          defaultTierKey={defaultTierKey}
          combinedParshaIds={combinedParshaIds}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- subviews

function ScriptCard({
  script,
  parshaId: hostParshaId,
  parshaName: hostParshaName,
  parshaSlug: hostParshaSlug,
  defaultTierKey,
  combinedParshaIds,
}: {
  script: CarouselScript;
  parshaId: string;
  parshaName: string;
  parshaSlug?: string;
  defaultTierKey?: string;
  combinedParshaIds?: string[];
}) {
  // When this script comes from a combined-parsha partner (e.g., Kedoshim
  // shown alongside Acharei Mot's scripts on Today), route Approve / Add
  // move / Edit actions to ITS parsha — not the host carousel's parsha.
  // Falls back to the carousel's host parsha when the script doesn't
  // declare its own (the normal single-parsha case).
  const parshaId = script.parsha_id ?? hostParshaId;
  const parshaName = script.parsha_name ?? hostParshaName;
  const parshaSlug = script.parsha_slug ?? hostParshaSlug;
  const isPartnerScript = !!script.parsha_id && script.parsha_id !== hostParshaId;
  // In a combined-parsha week, the OTHER parsha id in the pair — passed
  // through to the generate dialog so the resulting job tags both rows
  // of /parshiot's 54-grid as covered. Undefined for single-parsha weeks.
  const partnerParshaId = combinedParshaIds && combinedParshaIds.length > 1
    ? combinedParshaIds.find((id) => id !== parshaId)
    : undefined;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(script.draft_text ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveCache, setMoveCache] = useState<Record<string, TaiChiMove>>({});

  // Latest job for this script: drives the in-progress / video-ready UI
  // replacing the Generate button after the user submits a generation.
  type JobState = { id: string; status: string; statusMessage: string | null; videoId: string | null };
  const [job, setJob] = useState<JobState | null>(null);
  const IN_FLIGHT = useMemo(() => new Set([
    'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
    'generating_clips', 'stitching',
  ]), []);
  const fetchJob = async () => {
    try {
      const r = await fetch(`/api/jobs/for-script?scriptId=${encodeURIComponent(script.id)}`, { cache: 'no-store' });
      const data = await r.json();
      setJob(data.job ?? null);
    } catch {
      // Non-fatal: keep current state.
    }
  };
  useEffect(() => {
    void fetchJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.id]);
  // Poll every 5s while in-flight.
  useEffect(() => {
    if (!job || !IN_FLIGHT.has(job.status)) return;
    const t = setInterval(() => { void fetchJob(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, IN_FLIGHT]);
  // Optimistic local state — initialized from the prop, updated immediately on
  // a successful pick so the UI reflects the selection even if Next's server
  // re-fetch hasn't landed yet. The `useEffect` below re-syncs if the prop
  // changes (e.g., after router.refresh() or when navigating carousel slots).
  const [localSlug, setLocalSlug] = useState<string | null>(script.motion_ref_slug ?? null);
  useEffect(() => {
    setLocalSlug(script.motion_ref_slug ?? null);
  }, [script.id, script.motion_ref_slug]);
  const currentSlug = localSlug;
  const currentMove = currentSlug ? moveCache[currentSlug] : null;

  useEffect(() => {
    if (!currentSlug || moveCache[currentSlug]) return;
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, TaiChiMove> = {};
        for (const m of (data.moves ?? []) as TaiChiMove[]) map[m.slug] = m;
        setMoveCache(map);
      })
      .catch(() => {});
  }, [currentSlug, moveCache]);

  const handlePick = async (slug: string | null) => {
    const res = await addMoveToScript({
      scriptId: script.id,
      slug,
      parshaSlug,
    });
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setLocalSlug(slug);  // optimistic — update UI immediately
    // Intentionally NOT calling router.refresh(): it re-renders the whole
    // parsha tree, which resets the carousel's local `index` state and
    // jumps the user back to slot 0 (Script A) even if they were on
    // A-tight. The DB is already updated; the next full page load will
    // rehydrate correctly.
  };

  // Reset local draft whenever the script actually changes (carousel navigation).
  useMemo(() => {
    setDraft(script.draft_text ?? '');
    setEditing(false);
    setSaveError(null);
    setJustSaved(false);
  }, [script.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = wordCount(editing ? draft : script.draft_text);

  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const res = await saveScriptDraft({
        scriptId: script.id,
        draftText: draft,
        parshaSlug,
      });
      if (!res.ok) {
        setSaveError(res.error ?? 'Save failed');
        return;
      }
      setEditing(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      router.refresh();
    } catch (e) {
      setSaveError(`Save threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(script.draft_text ?? '');
    setEditing(false);
    setSaveError(null);
  };

  return (
    <div>
      {/* Combined-parsha partner label — only when this script is from
          the paired parsha (e.g. Kedoshim shown alongside Acharei Mot). */}
      {isPartnerScript && (
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
            marginBottom: '6px',
          }}
        >
          From {script.parsha_name}
        </div>
      )}
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

      {/* TLDR */}
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

      {/* Option + word count */}
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
        {optionLabel(script.option)} · {words} words{justSaved && ' · saved ✓'}
      </p>

      {/* Full draft — read mode or edit mode */}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          rows={14}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'var(--ff-reading)',
            fontSize: '15.5px',
            lineHeight: 1.65,
            color: 'var(--ink-900)',
            background: 'var(--linen-50)',
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
            resize: 'vertical',
            minHeight: '260px',
            marginBottom: '14px',
            outline: 'none',
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: 'var(--ff-reading)',
            fontSize: '16px',
            lineHeight: 1.65,
            color: 'var(--ink-800)',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
            marginBottom: '18px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {script.draft_text ? (
            script.draft_text
          ) : (
            <span style={{ fontStyle: 'italic', color: 'var(--ink-400)' }}>No draft text.</span>
          )}
        </div>
      )}

      {saveError && (
        <div style={{ padding: '10px 14px', marginBottom: '14px', borderRadius: 'var(--r-sm)', background: 'rgba(192,57,43,.08)', border: '1px solid rgba(192,57,43,.2)', color: '#8b2d1c', fontFamily: 'var(--ff-body)', fontSize: '12.5px' }}>
          {saveError}
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontFamily: 'var(--ff-body)',
                fontWeight: 500,
                fontSize: '14px',
                padding: '11px 22px',
                minHeight: '44px',
                borderRadius: '999px',
                border: '1px solid var(--navy-800)',
                background: saving || !draft.trim() ? 'var(--ink-300)' : 'var(--navy-800)',
                color: 'var(--linen-50)',
                cursor: saving ? 'wait' : 'pointer',
                transition: 'all var(--trans)',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '13px',
                color: 'var(--ink-500)',
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {job && IN_FLIGHT.has(job.status) ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '11px 18px', minHeight: '44px',
                borderRadius: '999px',
                border: '1px solid var(--navy-500)',
                background: 'var(--navy-wash)',
                color: 'var(--navy-800)',
                fontFamily: 'var(--ff-body)', fontSize: '13.5px', fontWeight: 500,
              }}>
                <span style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: 'var(--navy-700)',
                  animation: 'pulse-navy 1.8s ease-in-out infinite',
                }} />
                Generating · {job.statusMessage ?? job.status}
                <a href={`/jobs/${job.id}`} style={{
                  fontSize: '12.5px', color: 'var(--navy-800)',
                  textDecoration: 'underline', textDecorationColor: 'var(--navy-300)',
                  textUnderlineOffset: 3,
                }}>view progress →</a>
              </span>
            ) : job && job.status === 'done' && job.videoId ? (
              <>
                <a href={parshaSlug ? `/videos/${parshaSlug}` : `/jobs/${job.id}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px',
                  padding: '11px 22px', minHeight: '44px', borderRadius: '999px',
                  border: '1px solid var(--jade)',
                  background: 'var(--jade)', color: 'var(--linen-50)',
                  textDecoration: 'none',
                }}>
                  Video ready · watch →
                </a>
                <GenerateDialog
                  parshaId={parshaId}
                  scriptId={script.id}
                  parshaName={parshaName}
                  partnerParshaId={partnerParshaId}
                  defaultTierKey={defaultTierKey}
                  onJobCreated={(jobId) => setJob({ id: jobId, status: 'queued', statusMessage: null, videoId: null })}
                  triggerLabel="Regenerate"
                  triggerVariant="secondary"
                />
              </>
            ) : job && job.status === 'failed' ? (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '11px 18px', minHeight: '44px', borderRadius: '999px',
                  border: '1px solid var(--tassel)',
                  background: 'rgba(192,57,43,.08)',
                  color: 'var(--tassel)',
                  fontFamily: 'var(--ff-body)', fontSize: '13.5px', fontWeight: 500,
                }}>
                  Generation failed
                  <a href={`/jobs/${job.id}`} style={{
                    fontSize: '12.5px', color: 'var(--tassel)',
                    textDecoration: 'underline', textUnderlineOffset: 3,
                  }}>details →</a>
                </span>
                <GenerateDialog
                  parshaId={parshaId}
                  scriptId={script.id}
                  parshaName={parshaName}
                  partnerParshaId={partnerParshaId}
                  defaultTierKey={defaultTierKey}
                  onJobCreated={(jobId) => setJob({ id: jobId, status: 'queued', statusMessage: null, videoId: null })}
                />
              </>
            ) : (
              <GenerateDialog
                parshaId={parshaId}
                scriptId={script.id}
                parshaName={parshaName}
                partnerParshaId={partnerParshaId}
                defaultTierKey={defaultTierKey}
                onJobCreated={(jobId) => setJob({ id: jobId, status: 'queued', statusMessage: null, videoId: null })}
              />
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
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
            {currentSlug ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px',
                  color: 'var(--ink-700)',
                }}>
                  Move: <strong style={{ fontStyle: 'normal', fontWeight: 500 }}>
                    {currentMove?.english ?? currentSlug}
                  </strong>
                </span>
                <button type="button" onClick={() => setPickerOpen(true)} style={{
                  fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: 'var(--ink-500)',
                  background: 'none', border: 'none', padding: 0,
                  textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                  cursor: 'pointer',
                }}>change</button>
                <span style={{ color: 'var(--ink-300)' }}>·</span>
                <button type="button" onClick={() => handlePick(null)} style={{
                  fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: 'var(--ink-500)',
                  background: 'none', border: 'none', padding: 0,
                  textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                  cursor: 'pointer',
                }}>remove</button>
              </span>
            ) : (
              <button type="button" onClick={() => setPickerOpen(true)} style={{
                fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)',
                textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                textUnderlineOffset: 4, cursor: 'pointer',
                background: 'none', border: 'none', padding: 0, minHeight: 44,
                display: 'inline-flex', alignItems: 'center',
              }}>Add tai chi move</button>
            )}
            <TaiChiMovePicker
              open={pickerOpen}
              currentSlug={currentSlug}
              onSelect={(slug) => handlePick(slug)}
              onClose={() => setPickerOpen(false)}
            />
          </>
        )}
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
