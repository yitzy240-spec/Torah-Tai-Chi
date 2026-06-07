// dashboard/src/app/videos/[slug]/_components/posting-cards/facebook-card.tsx
//
// Mirrors TikTok/X cards — per-card useRealtimeRow dropped; parent (phase-5-post.tsx)
// keeps the post prop live via useRealtimeRows on the posts table.
// effectiveStatus = post?.status ?? null.
//
// Facebook-specific extras: ReelOrPostToggle + First-comment EditableField,
// both in the unposted state and the posted-expanded edit flow.
// social_metadata.facebook = { type, firstComment }.

'use client';
import { useState, useTransition } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { EditableField } from './_shared/editable-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { ReelOrPostToggle } from './_shared/reel-or-post-toggle';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { ScheduledStateCard } from './_shared/scheduled-state-card';
import { PostedExpandedHeader } from './_shared/posted-expanded-header';
import { FailureBanner } from './_shared/failure-banner';
import { PostActionButtons } from './_shared/post-action-buttons';
import { UnpostedCardShell } from './_shared/unposted-card-shell';
import { PlatformIcon } from '@/components/platform-icon';
import { BottomSheet } from '../bottom-sheet';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { saveSocialMetadata } from '@/app/actions/video-page/save-social-metadata';
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

interface SocialMeta {
  facebook?: { type: 'reel' | 'post'; firstComment?: string };
}

interface Props {
  jobId: string;
  videoId: string;
  parshaSlug: string;
  caption: string;
  post: PostRow | null;
  postUrl: string | null;
  socialMetadata: SocialMeta | null;
}

export function FacebookCard({ jobId, videoId, parshaSlug, caption, post, postUrl, socialMetadata }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editFlowOpen, setEditFlowOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reelOrPost, setReelOrPost] = useState<'reel' | 'post'>(socialMetadata?.facebook?.type ?? 'reel');
  const [firstComment, setFirstComment] = useState(socialMetadata?.facebook?.firstComment ?? '');
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = post?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';
  const isFailed = effectiveStatus === 'failed';

  async function saveFBMeta(type: 'reel' | 'post', fc: string) {
    await saveSocialMetadata(jobId, {
      social_metadata: {
        ...((socialMetadata ?? {}) as Record<string, unknown>),
        facebook: { type, firstComment: fc || undefined },
      },
    }, parshaSlug);
  }

  if (isScheduled && post) {
    return (
      <ScheduledStateCard
        platformName="Facebook"
        icon={<PlatformIcon name="facebook" size={14} />}
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
        icon={<PlatformIcon name="facebook" size={14} />}
        platform="Facebook"
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
          platformName="Facebook"
          icon={<PlatformIcon name="facebook" size={14} />}
          onCollapse={() => setExpanded(false)}
        />

        {editFlowOpen ? (
          <>
            <CaptionAndHashtags storageKey={`caption.facebook.${parshaSlug}.edit`} initialCombined={post?.caption ?? caption} onSave={async (next) => savePlatformCaption(jobId, 'facebook', next, parshaSlug)} />
            <ReelOrPostToggle value={reelOrPost} onChange={(v) => { setReelOrPost(v); saveFBMeta(v, firstComment); }} />
            <EditableField storageKey={`facebook.${parshaSlug}.firstComment.edit`} label="First comment" initialValue={firstComment} onSave={async (v) => { setFirstComment(v); await saveFBMeta(reelOrPost, v); }} multiline={false} />
            <button type="button" onClick={() => { startPosting(async () => { const res = await editPostedOnPlatform(videoId, 'facebook', caption); if (!res.ok) setError(res.error ?? 'Update failed'); else setEditFlowOpen(false); }); }} disabled={posting}
              style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}>
              {posting ? 'Updating…' : 'Update on Facebook'}
            </button>
            <button type="button" onClick={() => setEditFlowOpen(false)} style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--ink-500)', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{post?.caption ?? caption}</div>
            <button type="button" onClick={() => setEditConfirmOpen(true)}
              style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
              Edit on Facebook
            </button>
          </>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 6 }}>{error}</div>}

        <BottomSheet open={editConfirmOpen} onOpenChange={setEditConfirmOpen} title="Edit this post?"
          primaryAction={{ label: 'Yes — open editor', onClick: () => { setEditConfirmOpen(false); setEditFlowOpen(true); } }}
          secondaryAction={{ label: 'Cancel', onClick: () => setEditConfirmOpen(false) }}>
          {process.env.NEXT_PUBLIC_EDITPOST_BRANCH === 'A'
            ? 'Saving will update the post on Facebook. Likes and comments will be preserved.'
            : "Editing this post will unpost it from Facebook and post the new version. The original post's likes and comments will be lost."}
        </BottomSheet>
      </div>
    );
  }

  // Unposted
  async function onPost() {
    setError(null);
    await saveFBMeta(reelOrPost, firstComment);
    startPosting(async () => {
      const res = await postToPlatform(videoId, 'facebook', { facebook: caption }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <UnpostedCardShell platformName="Facebook" icon={<PlatformIcon name="facebook" size={14} />}>
      <CaptionAndHashtags storageKey={`caption.facebook.${parshaSlug}`} initialCombined={caption} onSave={async (next) => savePlatformCaption(jobId, 'facebook', next, parshaSlug)} />
      <ReelOrPostToggle value={reelOrPost} onChange={(v) => { setReelOrPost(v); saveFBMeta(v, firstComment); }} />
      <EditableField storageKey={`facebook.${parshaSlug}.firstComment`} label="First comment" initialValue={firstComment} onSave={async (v) => { setFirstComment(v); await saveFBMeta(reelOrPost, v); }} multiline={false} />

      {isFailed && <FailureBanner errorMessage={post?.error_message ?? null} />}

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <PostActionButtons
        posting={posting}
        onPost={onPost}
        onScheduleOpen={() => setScheduleOpen(true)}
        platformName="Facebook"
      />

      <ScheduleForLaterSheet open={scheduleOpen} onOpenChange={setScheduleOpen} platform="Facebook"
        onSchedule={async (when) => {
          await saveFBMeta(reelOrPost, firstComment);
          const res = await postToPlatform(videoId, 'facebook', { facebook: caption }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }} />
    </UnpostedCardShell>
  );
}
