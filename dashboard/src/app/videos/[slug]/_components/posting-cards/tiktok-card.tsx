// dashboard/src/app/videos/[slug]/_components/posting-cards/tiktok-card.tsx
//
// States per spec §5.3:
//   - Scheduled: "Scheduled for [date]" pill + cancel stub.
//   - Not posted: open + editable + "Post to TikTok" + "Schedule for later".
//   - Posted + collapsed (default): PostedSummaryRow. Tap to expand.
//   - Posted + expanded: read-only caption + "Edit on TikTok" button.
//   - Edit flow: fields editable + "Update on TikTok" CTA + §13 warning copy.

'use client';
import { useState, useTransition } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { BottomSheet } from '../bottom-sheet';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { editPostedOnPlatform } from '@/app/actions/video-page/edit-posted';

interface PostRow {
  status: string;
  created_at: string;
  scheduled_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
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

  const isPosted = post?.status === 'published';
  const isScheduled = post?.status === 'scheduled';

  // Scheduled state
  if (isScheduled && post) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>📱 TikTok · Scheduled</div>
        <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
          Scheduled for{' '}
          {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : 'unknown time'}
        </div>
        <button
          type="button"
          style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-400)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onClick={() => {
            // TODO: cancel scheduled post — out of scope for M5
            alert('Cancel scheduled post coming soon.');
          }}
        >
          Cancel scheduled post
        </button>
      </div>
    );
  }

  // Posted + collapsed
  if (isPosted && !expanded) {
    return (
      <PostedSummaryRow
        icon="📱"
        platform="TikTok"
        postedAt={post!.created_at}
        postUrl={postUrl}
        onExpand={() => setExpanded(true)}
      />
    );
  }

  // Posted + expanded
  if (isPosted && expanded) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <strong style={{ fontSize: 13 }}>📱 TikTok</strong>
            <span style={{ fontSize: 11, color: 'var(--jade)', marginLeft: 6 }}>● Posted</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 18 }}
          >
            ▴
          </button>
        </div>

        {/* Edit flow: editable fields + "Update on TikTok" */}
        {editFlowOpen ? (
          <>
            <CaptionAndHashtags
              storageKey={`caption.tiktok.${parshaSlug}.edit`}
              initialCombined={post?.caption ?? caption}
              onSave={async (next) => savePlatformCaption(jobId, 'tiktok', next)}
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

        {/* Branch A/B confirm sheet */}
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

  // Unposted: editable
  async function onPost() {
    setError(null);
    startPosting(async () => {
      const res = await postToPlatform(videoId, 'tiktok', { tiktok: caption }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <div style={{ border: '1.5px solid var(--navy-700)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'white' }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>
        📱 TikTok · next up
      </div>

      <CaptionAndHashtags
        storageKey={`caption.tiktok.${parshaSlug}`}
        initialCombined={caption}
        onSave={async (next) => savePlatformCaption(jobId, 'tiktok', next)}
      />

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <button
        type="button"
        onClick={onPost}
        disabled={posting}
        style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 8 }}
      >
        {posting ? 'Posting to TikTok…' : 'Post to TikTok'}
      </button>

      <button
        type="button"
        onClick={() => setScheduleOpen(true)}
        style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--navy-700)', border: '1px solid var(--ink-100)', borderRadius: 8, cursor: 'pointer' }}
      >
        Schedule for later
      </button>

      <ScheduleForLaterSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        platform="TikTok"
        onSchedule={async (when) => {
          const res = await postToPlatform(videoId, 'tiktok', { tiktok: caption }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }}
      />
    </div>
  );
}
