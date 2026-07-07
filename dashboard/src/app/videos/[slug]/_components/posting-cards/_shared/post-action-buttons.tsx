'use client';

interface Props {
  posting: boolean;
  onPost: () => void;
  onScheduleOpen: () => void;
  platformName: string;          // shown in "Post to {name}" / "Posting to {name}…"
  /** Override the posting verb. Default: `Posting to {platformName}…`. YouTube uses "Uploading to YouTube…". */
  postingLabel?: string;
  /** Override the static button verb. Default: `Post to {platformName}`. */
  postLabel?: string;
  /** Disable posting + scheduling (e.g. tweet over X's limit). */
  disabled?: boolean;
}

export function PostActionButtons({
  posting,
  onPost,
  onScheduleOpen,
  platformName,
  postingLabel,
  postLabel,
  disabled = false,
}: Props) {
  const postBlocked = posting || disabled;
  return (
    <>
      <button
        type="button"
        onClick={onPost}
        disabled={postBlocked}
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 14,
          fontWeight: 500,
          background: 'var(--navy-700)',
          color: 'var(--linen-50)',
          border: 'none',
          borderRadius: 8,
          padding: 12,
          cursor: postBlocked ? 'not-allowed' : 'pointer',
          opacity: postBlocked ? 0.7 : 1,
          marginBottom: 8,
        }}
      >
        {posting ? (postingLabel ?? `Posting to ${platformName}…`) : (postLabel ?? `Post to ${platformName}`)}
      </button>
      <button
        type="button"
        onClick={onScheduleOpen}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: 44,
          fontSize: 13,
          background: 'transparent',
          color: 'var(--navy-700)',
          border: '1px solid var(--ink-100)',
          borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        Schedule for later
      </button>
    </>
  );
}
