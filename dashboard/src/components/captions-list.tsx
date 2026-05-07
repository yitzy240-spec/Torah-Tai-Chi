'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from './platform-icon';
import {
  CAPTION_FIELDS,
  CAPTION_FIELD_LIMITS,
  CAPTION_FIELD_DISPLAY,
  CAPTION_FIELD_PLATFORM,
  type CaptionField,
  type Platform,
} from '@/lib/platforms';
import { updateCaption } from '@/app/actions/update-caption';

/**
 * localStorage key for an in-progress caption edit. Scoped per
 * (jobId, field) so editing TikTok on one video doesn't shadow
 * Instagram on another. Drafts older than DRAFT_TTL_MS are ignored on
 * restore so a 6-month-old typo doesn't reappear.
 */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function draftKey(jobId: string, field: CaptionField): string {
  return `tt-caption-draft:${jobId}:${field}`;
}

interface SavedDraft {
  text: string;
  savedAt: number;
}

function readSavedDraft(jobId: string, field: CaptionField): SavedDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(draftKey(jobId, field));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDraft>;
    if (typeof parsed?.text !== 'string' || typeof parsed?.savedAt !== 'number') {
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) return null;
    return { text: parsed.text, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function writeSavedDraft(jobId: string, field: CaptionField, text: string): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: SavedDraft = { text, savedAt: Date.now() };
    window.localStorage.setItem(draftKey(jobId, field), JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — silently skip. The
    // textarea state still has the latest text in-memory.
  }
}

function clearSavedDraft(jobId: string, field: CaptionField): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(draftKey(jobId, field)); } catch { /* ignore */ }
}

function formatRestoredAt(savedAt: number): string {
  const elapsedMs = Date.now() - savedAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  jobId: string | null;
  /** Per-field caption text. Keys are caption fields (so YouTube has
   *  two distinct entries: youtube_title and youtube_description). */
  captions: Partial<Record<CaptionField, string>>;
  parshaSlug?: string;
  /** Platforms that are actually wired up. Caption fields whose
   *  underlying platform isn't in this list are hidden so Yonah doesn't
   *  edit copy that won't post anywhere. When undefined, all fields render. */
  connectedPlatforms?: Platform[];
}

export function CaptionsList({ jobId, captions, parshaSlug, connectedPlatforms }: Props) {
  const [editingField, setEditingField] = useState<CaptionField | null>(null);
  const [draft, setDraft] = useState('');
  /** Original DB value the editor was opened on. Used to decide whether
   *  the textarea diverges from the DB (write a draft) or matches it
   *  (clear the draft). Without this we'd persist every keystroke even
   *  when the user has only typed and then deleted back to the original
   *  text — the "Restored" banner would then flash every time. */
  const [editOriginal, setEditOriginal] = useState<string>('');
  /** Set when startEdit found a saved draft that differs from the DB
   *  caption AND is younger than DRAFT_TTL_MS. The banner only shows
   *  on the first edit-open after a restore. */
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Persist every keystroke (only when it diverges from the DB caption
  // and only when an edit is open). On match-DB or close, clear the
  // saved draft so we don't restore a value the user has implicitly
  // accepted by typing it back.
  useEffect(() => {
    if (!editingField || !jobId) return;
    if (draft === editOriginal) {
      clearSavedDraft(jobId, editingField);
    } else {
      writeSavedDraft(jobId, editingField, draft);
    }
  }, [draft, editingField, editOriginal, jobId]);

  const startEdit = (field: CaptionField, current: string) => {
    setError(null);
    setEditingField(field);
    setEditOriginal(current);
    if (jobId) {
      const saved = readSavedDraft(jobId, field);
      if (saved && saved.text !== current) {
        // Restore the unsaved draft — exactly the case Yonah hit:
        // typed new TikTok caption, Save errored, his work was gone.
        // With this branch his draft survives a refresh / machine
        // close-and-reopen for up to DRAFT_TTL_MS.
        setDraft(saved.text);
        setRestoredAt(saved.savedAt);
        return;
      }
    }
    setDraft(current);
    setRestoredAt(null);
  };

  /** Hard discard: clear the saved draft AND revert the textarea to the
   *  DB value. Used by the "Discard draft" button on the restored
   *  banner so Yonah can explicitly throw away a stale draft without
   *  having to manually delete every character. */
  const discardDraft = () => {
    if (!editingField || !jobId) return;
    clearSavedDraft(jobId, editingField);
    setDraft(editOriginal);
    setRestoredAt(null);
  };

  const cancel = () => {
    if (editingField && jobId) clearSavedDraft(jobId, editingField);
    setEditingField(null);
    setDraft('');
    setEditOriginal('');
    setRestoredAt(null);
    setError(null);
  };

  const save = () => {
    if (!editingField || !jobId) return;
    setError(null);
    const fieldAtSubmit = editingField;
    const jobIdAtSubmit = jobId;
    startTransition(async () => {
      const res = await updateCaption({
        jobId: jobIdAtSubmit,
        field: fieldAtSubmit,
        text: draft,
        parshaSlug,
      });
      if (res.error) {
        // Save failed — keep the draft in place AND in localStorage so
        // a subsequent refresh / machine-switch doesn't lose the user's
        // typing. (This is the exact scenario from 2026-05-07: "No clip
        // plan found" error wiped Yonah's TikTok edits.)
        setError(res.error);
        return;
      }
      // Success: clear the saved draft so it doesn't shadow the new DB
      // value next time the editor opens.
      clearSavedDraft(jobIdAtSubmit, fieldAtSubmit);
      cancel();
      router.refresh();
    });
  };

  const allowedFields: readonly CaptionField[] = connectedPlatforms
    ? CAPTION_FIELDS.filter((f) =>
        connectedPlatforms.includes(CAPTION_FIELD_PLATFORM[f]),
      )
    : CAPTION_FIELDS;

  const rows = allowedFields
    .map((f) => ({ field: f, caption: captions[f] ?? null }))
    .filter((r): r is { field: CaptionField; caption: string } => !!r.caption);

  if (rows.length === 0) {
    return (
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13px',
          color: 'var(--ink-400)',
          margin: 0,
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        No captions yet — generate the video to populate them.
      </p>
    );
  }

  return (
    <>
      {rows.map(({ field, caption }) => {
        const isEditing = editingField === field;
        const overLimit = isEditing && draft.length > CAPTION_FIELD_LIMITS[field];
        const platform = CAPTION_FIELD_PLATFORM[field];
        const label = CAPTION_FIELD_DISPLAY[field];

        return (
          <div
            key={field}
            style={{
              padding: '12px 14px',
              border: `1px solid ${isEditing ? 'var(--navy-300)' : 'var(--ink-100)'}`,
              borderRadius: 'var(--r-md)',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              background: isEditing ? 'var(--navy-wash)' : 'transparent',
              transition: 'all var(--trans)',
            }}
          >
            <span
              style={{
                width: '22px',
                height: '22px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-500)',
                marginTop: isEditing ? 6 : 0,
              }}
            >
              <PlatformIcon name={platform} size={18} />
            </span>

            {isEditing ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-500)',
                    marginBottom: '6px',
                  }}
                >
                  {label}
                </div>
                {restoredAt !== null && (
                  <div
                    role="status"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '8px 12px',
                      marginBottom: '8px',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--cedar-400)',
                      background: 'rgba(168,114,47,.08)',
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12px',
                      color: 'var(--ink-700)',
                      fontVariationSettings: '"opsz" 14, "SOFT" 50',
                    }}
                  >
                    <span>
                      Restored unsaved draft from {formatRestoredAt(restoredAt)}.
                    </span>
                    <button
                      type="button"
                      onClick={discardDraft}
                      style={{
                        fontFamily: 'var(--ff-body)',
                        fontStyle: 'normal',
                        fontSize: '11.5px',
                        color: 'var(--cedar-700)',
                        textDecoration: 'underline',
                        textUnderlineOffset: 2,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Discard draft
                    </button>
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={field === 'youtube_title' ? 2 : field === 'youtube_description' ? 6 : 4}
                  autoFocus
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontFamily: 'var(--ff-body)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    color: 'var(--ink-900)',
                    padding: '10px 12px',
                    border: '1px solid var(--ink-200)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--linen-50)',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={save}
                    disabled={isPending || overLimit}
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontWeight: 500,
                      fontSize: '13px',
                      padding: '8px 16px',
                      minHeight: '36px',
                      borderRadius: '999px',
                      border: '1px solid var(--navy-800)',
                      background: overLimit ? 'var(--ink-300)' : 'var(--navy-800)',
                      color: 'var(--linen-50)',
                      cursor: isPending || overLimit ? 'not-allowed' : 'pointer',
                      opacity: isPending ? 0.6 : 1,
                    }}
                  >
                    {isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={isPending}
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: '13px',
                      padding: '8px 14px',
                      minHeight: '36px',
                      borderRadius: '999px',
                      border: '1px solid var(--ink-200)',
                      background: 'transparent',
                      color: 'var(--ink-700)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: '11.5px',
                      color: overLimit ? 'var(--tassel)' : 'var(--ink-400)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {draft.length}/{CAPTION_FIELD_LIMITS[field]}
                  </span>
                </div>
                {error && (
                  <p
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: '12px',
                      color: 'var(--tassel)',
                      margin: '6px 0 0 0',
                    }}
                  >
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: '11px',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-500)',
                      marginBottom: '4px',
                    }}
                  >
                    {label}
                  </div>
                  <span
                    style={{
                      fontSize: '13px',
                      color: 'var(--ink-700)',
                      lineHeight: 1.45,
                      overflowWrap: 'anywhere',
                      whiteSpace: 'pre-wrap',
                      display: 'block',
                    }}
                  >
                    {caption}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(field, caption)}
                  disabled={!jobId}
                  title={jobId ? undefined : 'Generate the video first'}
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '12px',
                    color: jobId ? 'var(--navy-700)' : 'var(--ink-300)',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--ink-200)',
                    textUnderlineOffset: '3px',
                    cursor: jobId ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                  }}
                >
                  Edit
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
