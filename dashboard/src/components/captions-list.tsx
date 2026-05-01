'use client';

import { useState, useTransition } from 'react';
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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const startEdit = (field: CaptionField, current: string) => {
    setError(null);
    setEditingField(field);
    setDraft(current);
  };

  const cancel = () => {
    setEditingField(null);
    setDraft('');
    setError(null);
  };

  const save = () => {
    if (!editingField || !jobId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateCaption({
        jobId,
        field: editingField,
        text: draft,
        parshaSlug,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
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
