// dashboard/src/app/videos/[slug]/_components/posting-cards/tiktok-card.tsx
//
// TikTok card — caption + hashtags via CaptionAndHashtags.
//
// Post prop is kept live by parent (phase-5-post.tsx) via useRealtimeRows on
// the posts table — per-card subscription is redundant and was costing a
// duplicate WAL-decode filter per card.

'use client';
import { useState, useTransition } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { ScheduledStateCard } from './_shared/scheduled-state-card';
import { PostedExpandedHeader } from './_shared/posted-expanded-header';
import { FailureBanner } from './_shared/failure-banner';
import { PostActionButtons } from './_shared/post-action-buttons';
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

export function TikTokCard({ jobId, videoId, parshaSlug, caption, post, postUrl }: Props) {
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
        platformName="TikTok"
        icon={<PlatformIcon name="tiktok" size={14} />}
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
        icon={<PlatformIcon name="tiktok" size={14} />}
        platform="TikTok"
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
          platformName="TikTok"
          icon={<PlatformIcon name="tiktok" size={14} />}
          onCollapse={() => setExpanded(false)}
        />

        {editFlowOpen ? (
          <>
            <CaptionAndHashtags
              storageKey={`caption.tiktok.${parshaSlug}.edit`}
              initialCombined={post?.caption ?? caption}
              onSave={async (next) => savePlatformCaption(jobId, 'tiktok', next, parshaSlug)}
            />
            <button
              type="button"
              onClick={() => {
                startPosting(async () => {
                  setError(null);
                  const res = await editPostedOnPlatform(videoId, 'tiktok', caption);
                  if (!res.ok) setError(res.error ?? 'Update failed');
                  else setEditFlowOpen(false);
                });
              }}
              disabled={posting}
              style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}
            >
              {posting ? 'Updating…' : 'Update on TikTok'}
            </button>
            <button
              type="button"
              onClick={() => setEditFlowOpen(false)}
              style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--ink-500)', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {post?.caption ?? caption}
            </div>
            <button
              type="button"
              onClick={() => setEditConfirmOpen(true)}
              style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}
            >
              Edit on TikTok
            </button>
          </>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 6 }}>{error}</div>}

        <BottomSheet
          open={editConfirmOpen}
          onOpenChange={setEditConfirmOpen}
          title="Edit this post?"
          primaryAction={{
            label: 'Yes — open editor',
            onClick: () => { setEditConfirmOpen(false); setEditFlowOpen(true); },
          }}
          secondaryAction={{ label: 'Cancel', onClick: () => setEditConfirmOpen(false) }}
        >
          {process.env.NEXT_PUBLIC_EDITPOST_BRANCH === 'A'
            ? 'Saving will update the post on TikTok. Likes and comments will be preserved.'
            : "Editing this post will unpost it from TikTok and post the new version. The original post's likes and comments will be lost."}
        </BottomSheet>
      </div>
    );
  }

  // Unposted
  async function onPost() {
    setError(null);
    startPosting(async () => {
      const res = await postToPlatform(videoId, 'tiktok', { tiktok: caption }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <UnpostedCardShell platformName="TikTok" icon={<PlatformIcon name="tiktok" size={14} />}>
      <CaptionAndHashtags
        storageKey={`caption.tiktok.${parshaSlug}`}
        initialCombined={caption}
        onSave={async (next) => savePlatformCaption(jobId, 'tiktok', next, parshaSlug)}
      />

      {isFailed && <FailureBanner errorMessage={post?.error_message ?? null} />}

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <PostActionButtons
        posting={posting}
        onPost={onPost}
        onScheduleOpen={() => setScheduleOpen(true)}
        platformName="TikTok"
      />

      <ScheduleForLaterSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        platform="TikTok"
        onSchedule={async (when) => {
          const res = await postToPlatform(videoId, 'tiktok', { tiktok: caption }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }}
      />
    </UnpostedCardShell>
  );
}
