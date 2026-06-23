// dashboard/src/app/videos/[slug]/_components/posting-cards/x-card.tsx
//
// Minimal card — tweet text only. Thread continuation deferred per kickoff out-of-scope.
// Platform key is 'twitter' (matches platforms.ts). Display label is "X".
//
// Post prop is kept live by parent (phase-5-post.tsx) via useRealtimeRows on
// the posts table — per-card subscription is redundant and was costing a
// duplicate WAL-decode filter per card.

'use client';
import { useState, useTransition } from 'react';
import { EditableField } from './_shared/editable-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { ScheduledStateCard } from './_shared/scheduled-state-card';
import { PostedExpandedHeader } from './_shared/posted-expanded-header';
import { FailureBanner } from './_shared/failure-banner';
import { PostActionButtons } from './_shared/post-action-buttons';
import { PostErrorHint } from './_shared/post-error-hint';
import { UnpostedCardShell } from './_shared/unposted-card-shell';
import { BottomSheet } from '../bottom-sheet';
import { PlatformIcon } from '@/components/platform-icon';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { editPostedOnPlatform } from '@/app/actions/video-page/edit-posted';

interface PostRow {
  id: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
  error_message: string | null;
}

interface Props {
  jobId: string;
  videoId: string;
  parshaSlug: string;
  caption: string;
  post: PostRow | null;
  postUrl: string | null;
}

export function XCard({ jobId, videoId, parshaSlug, caption, post, postUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editFlowOpen, setEditFlowOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = post?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';
  const isFailed = effectiveStatus === 'failed';

  if (isScheduled && post) {
    return (
      <ScheduledStateCard
        platformName="X"
        icon={<PlatformIcon name="twitter" size={14} />}
        scheduledAt={post.scheduled_at}
        bufferUpdateId={post.buffer_update_id}
        externalEditUrl={(id) => `https://buffer.com/app/updates/${id}`}
        externalListUrl="https://buffer.com/app"
      />
    );
  }

  if (isPosted && !expanded) {
    return (
      <PostedSummaryRow
        icon={<PlatformIcon name="twitter" size={14} />}
        platform="X"
        postedAt={post?.published_at ?? post!.created_at}
        postUrl={postUrl}
        onExpand={() => setExpanded(true)}
      />
    );
  }

  if (isPosted && expanded) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <PostedExpandedHeader
          platformName="X"
          icon={<PlatformIcon name="twitter" size={14} />}
          onCollapse={() => setExpanded(false)}
        />

        {editFlowOpen ? (
          <>
            <EditableField storageKey={`caption.twitter.${parshaSlug}.edit`} label="Tweet text" initialValue={post?.caption ?? caption} onSave={async (v) => savePlatformCaption(jobId, 'twitter', v, parshaSlug)} minHeight={60} />
            <button type="button" onClick={() => { startPosting(async () => { const res = await editPostedOnPlatform(videoId, 'twitter', caption); if (!res.ok) setError(res.error ?? 'Update failed'); else setEditFlowOpen(false); }); }} disabled={posting}
              style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}>
              {posting ? 'Updating…' : 'Update on X'}
            </button>
            <button type="button" onClick={() => setEditFlowOpen(false)} style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--ink-500)', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{post?.caption ?? caption}</div>
            <button type="button" onClick={() => setEditConfirmOpen(true)}
              style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
              Edit on X
            </button>
          </>
        )}

        <PostErrorHint error={error} platform="X" style={{ marginTop: 6 }} />

        <BottomSheet open={editConfirmOpen} onOpenChange={setEditConfirmOpen} title="Edit this post?"
          primaryAction={{ label: 'Yes — open editor', onClick: () => { setEditConfirmOpen(false); setEditFlowOpen(true); } }}
          secondaryAction={{ label: 'Cancel', onClick: () => setEditConfirmOpen(false) }}>
          {process.env.NEXT_PUBLIC_EDITPOST_BRANCH === 'A'
            ? 'Saving will update the post on X. Likes and replies will be preserved.'
            : "Editing this post will delete it from X and post the new version. The original post's likes and replies will be lost."}
        </BottomSheet>
      </div>
    );
  }

  // Unposted
  async function onPost() {
    setError(null);
    startPosting(async () => {
      const res = await postToPlatform(videoId, 'twitter', { twitter: caption }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <UnpostedCardShell platformName="X" icon={<PlatformIcon name="twitter" size={14} />}>
      <EditableField
        storageKey={`caption.twitter.${parshaSlug}`}
        label="Tweet text"
        initialValue={caption}
        onSave={(v) => savePlatformCaption(jobId, 'twitter', v, parshaSlug)}
        minHeight={60}
        placeholder="Short tweet for this video…"
      />
      <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: -8, marginBottom: 10 }}>
        {caption.length}/280 chars · Thread continuation deferred
      </div>

      {isFailed && <FailureBanner errorMessage={post?.error_message ?? null} />}

      <PostErrorHint error={error} platform="X" />

      <PostActionButtons
        posting={posting}
        onPost={onPost}
        onScheduleOpen={() => setScheduleOpen(true)}
        platformName="X"
      />

      <ScheduleForLaterSheet open={scheduleOpen} onOpenChange={setScheduleOpen} platform="X"
        onSchedule={async (when) => {
          const res = await postToPlatform(videoId, 'twitter', { twitter: caption }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }} />
    </UnpostedCardShell>
  );
}
