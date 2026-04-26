'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from './platform-icon';
import { PLATFORMS, CAPTION_LIMITS, type Platform } from '@/lib/platforms';
import { updateCaption } from '@/app/actions/update-caption';

interface Props {
  jobId: string | null;
  captions: Partial<Record<Platform, string>>;
  parshaSlug?: string;
}

export function CaptionsList({ jobId, captions, parshaSlug }: Props) {
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const startEdit = (platform: Platform, current: string) => {
    setError(null);
    setEditingPlatform(platform);
    setDraft(current);
  };

  const cancel = () => {
    setEditingPlatform(null);
    setDraft('');
    setError(null);
  };

  const save = () => {
    if (!editingPlatform || !jobId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateCaption({
        jobId,
        platform: editingPlatform,
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

  const rows = PLATFORMS
    .map((p) => ({ platform: p, caption: captions[p] ?? null }))
    .filter((r): r is { platform: Platform; caption: string } => !!r.caption);

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
      {rows.map(({ platform, caption }) => {
        const isEditing = editingPlatform === platform;
        const overLimit = isEditing && draft.length > CAPTION_LIMITS[platform];

        return (
          <div
            key={platform}
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
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={platform === 'youtube' ? 6 : 4}
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
                    {draft.length}/{CAPTION_LIMITS[platform]}
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
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--ink-700)',
                    flex: 1,
                    minWidth: 0,
                    lineHeight: 1.45,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {caption}
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(platform, caption)}
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
