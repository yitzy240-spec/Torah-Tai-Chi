// dashboard/src/app/videos/[slug]/_components/posting-cards/instagram-card.tsx
//
// Post-status source-of-truth: useRealtimeRow on the posts row (by post.id).
// Parent (phase-5-post.tsx) also runs useRealtimeRows on the posts table
// filtered by video_id, so the prop already updates live; the per-card
// useRealtimeRow here is defense-in-depth: it survives any future change
// to the parent and includes a 10s defensive poll if websocket drops.
// effectiveStatus = livePost?.status ?? post?.status ?? null.
//
// Mirrors TikTokCard + adds:
//   - First-comment field (label includes "may not appear on IG — Buffer report")
//   - ReelOrPostToggle
// Reel/Post + first-comment fields persist via saveSocialMetadata under social_metadata.instagram.

'use client';
import { useState, useTransition } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { EditableField } from './_shared/editable-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { ReelOrPostToggle } from './_shared/reel-or-post-toggle';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { BottomSheet } from '../bottom-sheet';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { saveSocialMetadata } from '@/app/actions/video-page/save-social-metadata';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { editPostedOnPlatform } from '@/app/actions/video-page/edit-posted';
import { useRealtimeRow } from '@/hooks/use-realtime-row';

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
  instagram?: { type: 'reel' | 'post'; firstComment?: string };
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

export function InstagramCard({ jobId, videoId, parshaSlug, caption, post, postUrl, socialMetadata }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editFlowOpen, setEditFlowOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reelOrPost, setReelOrPost] = useState<'reel' | 'post'>(socialMetadata?.instagram?.type ?? 'reel');
  const [firstComment, setFirstComment] = useState(socialMetadata?.instagram?.firstComment ?? '');
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Subscribe to this card's posts row so a late 'failed' status (Buffer
  // rate limit, async Modal worker failure) lands without manual refresh.
  const livePost = useRealtimeRow<PostRow>('posts', post?.id ?? null, post ?? null);
  const effectivePost = livePost ?? post ?? null;
  const effectiveStatus = effectivePost?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';
  const isFailed = effectiveStatus === 'failed';

  async function saveInstaMeta(type: 'reel' | 'post', fc: string) {
    await saveSocialMetadata(jobId, {
      social_metadata: {
        ...((socialMetadata ?? {}) as Record<string, unknown>),
        instagram: { type, firstComment: fc || undefined },
      },
    });
  }

  // Scheduled state
  if (isScheduled && post) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>📷 Instagram · Scheduled</div>
        <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
          Scheduled for {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : 'unknown'}
        </div>
        <button type="button" style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-400)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onClick={() => alert('Cancel scheduled post coming soon.')}>
          Cancel scheduled post
        </button>
      </div>
    );
  }

  if (isPosted && !expanded) {
    return (
      <PostedSummaryRow
        icon="📷"
        platform="Instagram"
        postedAt={post!.created_at}
        postUrl={postUrl}
        onExpand={() => setExpanded(true)}
      />
    );
  }

  if (isPosted && expanded) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <strong style={{ fontSize: 13 }}>📷 Instagram</strong>
            <span style={{ fontSize: 11, color: 'var(--jade)', marginLeft: 6 }}>● Posted</span>
          </div>
          <button type="button" onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 18 }}>▴</button>
        </div>

        {editFlowOpen ? (
          <>
            <CaptionAndHashtags
              storageKey={`caption.instagram.${parshaSlug}.edit`}
              initialCombined={post?.caption ?? caption}
              onSave={async (next) => savePlatformCaption(jobId, 'instagram', next)}
            />
            <ReelOrPostToggle value={reelOrPost} onChange={(v) => { setReelOrPost(v); saveInstaMeta(v, firstComment); }} />
            <EditableField storageKey={`instagram.${parshaSlug}.firstComment.edit`} label="First comment" labelNote="(may not appear on IG — Buffer report)" initialValue={firstComment} onSave={async (v) => { setFirstComment(v); await saveInstaMeta(reelOrPost, v); }} multiline={false} />
            <button type="button" onClick={() => { startPosting(async () => { const res = await editPostedOnPlatform(videoId, 'instagram', caption); if (!res.ok) setError(res.error ?? 'Update failed'); else setEditFlowOpen(false); }); }} disabled={posting}
              style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}>
              {posting ? 'Updating…' : 'Update on Instagram'}
            </button>
            <button type="button" onClick={() => setEditFlowOpen(false)} style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--ink-500)', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {post?.caption ?? caption}
            </div>
            <button type="button" onClick={() => setEditConfirmOpen(true)}
              style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
              Edit on Instagram
            </button>
          </>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 6 }}>{error}</div>}

        <BottomSheet open={editConfirmOpen} onOpenChange={setEditConfirmOpen} title="Edit this post?"
          primaryAction={{ label: 'Yes — open editor', onClick: () => { setEditConfirmOpen(false); setEditFlowOpen(true); } }}
          secondaryAction={{ label: 'Cancel', onClick: () => setEditConfirmOpen(false) }}>
          {process.env.NEXT_PUBLIC_EDITPOST_BRANCH === 'A'
            ? 'Saving will update the post on Instagram. Likes and comments will be preserved.'
            : "Editing this post will unpost it from Instagram and post the new version. The original post's likes and comments will be lost."}
        </BottomSheet>
      </div>
    );
  }

  // Unposted
  async function onPost() {
    setError(null);
    await saveInstaMeta(reelOrPost, firstComment);
    startPosting(async () => {
      const res = await postToPlatform(videoId, 'instagram', { instagram: caption }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <div style={{ border: '1.5px solid var(--navy-700)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'white' }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>
        📷 Instagram · next up
      </div>

      <CaptionAndHashtags
        storageKey={`caption.instagram.${parshaSlug}`}
        initialCombined={caption}
        onSave={async (next) => savePlatformCaption(jobId, 'instagram', next)}
      />
      <ReelOrPostToggle value={reelOrPost} onChange={(v) => { setReelOrPost(v); saveInstaMeta(v, firstComment); }} />
      <EditableField storageKey={`instagram.${parshaSlug}.firstComment`} label="First comment" labelNote="(may not appear on IG — Buffer report)" initialValue={firstComment}
        onSave={async (v) => { setFirstComment(v); await saveInstaMeta(reelOrPost, v); }} multiline={false} />

      {isFailed && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            marginBottom: 10,
            background: 'rgba(207, 109, 81, 0.08)',
            border: '1px solid var(--tassel)',
            borderRadius: 6,
            fontSize: 12.5,
            color: 'var(--ink-700)',
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--tassel)', fontWeight: 700, flexShrink: 0 }}>!</span>
          <span>
            Last post attempt failed.
            {effectivePost?.error_message ? <> <span style={{ color: 'var(--ink-500)' }}>{String(effectivePost.error_message).split('\n')[0].slice(0, 180)}</span></> : null}
            {' '}Tap to retry.
          </span>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <button type="button" onClick={onPost} disabled={posting}
        style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 8 }}>
        {posting ? 'Posting to Instagram…' : 'Post to Instagram'}
      </button>

      <button type="button" onClick={() => setScheduleOpen(true)}
        style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--navy-700)', border: '1px solid var(--ink-100)', borderRadius: 8, cursor: 'pointer' }}>
        Schedule for later
      </button>

      <ScheduleForLaterSheet open={scheduleOpen} onOpenChange={setScheduleOpen} platform="Instagram"
        onSchedule={async (when) => {
          await saveInstaMeta(reelOrPost, firstComment);
          const res = await postToPlatform(videoId, 'instagram', { instagram: caption }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }} />
    </div>
  );
}
