// dashboard/src/app/videos/[slug]/_components/posting-cards/facebook-card.tsx
//
// Mirrors TikTok/X cards — per-card useRealtimeRow dropped; parent (phase-5-post.tsx)
// keeps the post prop live via useRealtimeRows on the posts table.
// effectiveStatus = post?.status ?? null.
//
// Facebook-specific extras: ReelOrPostToggle + First-comment EditableField,
// both in the unposted Buffer flow and the posted-expanded Buffer edit flow.
// Native "Post manually" is the primary unposted path (FB buries tool-published
// posts). social_metadata.facebook = { type, firstComment }.

'use client';
import { useState, useTransition, type CSSProperties } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { downloadUrl } from '@/lib/storage-url';
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
import { recordManualPost } from '@/app/actions/video-page/record-manual-post';

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
  videoMp4Url: string | null;
}

const btnPrimary: CSSProperties = {
  width: '100%',
  minHeight: 48,
  fontSize: 14,
  fontWeight: 500,
  background: 'var(--navy-700)',
  color: 'var(--linen-50)',
  border: 'none',
  borderRadius: 8,
  padding: 12,
};

const btnSecondary: CSSProperties = {
  width: '100%',
  minHeight: 44,
  fontSize: 13,
  fontWeight: 500,
  background: 'white',
  color: 'var(--navy-700)',
  border: '1px solid var(--navy-700)',
  borderRadius: 8,
};

export function FacebookCard({ jobId, videoId, parshaSlug, caption, post, postUrl, socialMetadata, videoMp4Url }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editFlowOpen, setEditFlowOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [mode, setMode] = useState<'manual' | 'buffer'>('manual');
  const [reelLink, setReelLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [reelOrPost, setReelOrPost] = useState<'reel' | 'post'>(socialMetadata?.facebook?.type ?? 'reel');
  const [firstComment, setFirstComment] = useState(socialMetadata?.facebook?.firstComment ?? '');
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = post?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';
  const isFailed = effectiveStatus === 'failed';
  const isManualPost = isPosted && !post?.buffer_update_id;

  async function saveFBMeta(type: 'reel' | 'post', fc: string) {
    await saveSocialMetadata(jobId, {
      social_metadata: {
        ...((socialMetadata ?? {}) as Record<string, unknown>),
        facebook: { type, firstComment: fc || undefined },
      },
    }, parshaSlug);
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Long-press the caption to copy it.');
    }
  }

  function markPosted(link: string) {
    setError(null);
    startPosting(async () => {
      const res = await recordManualPost(videoId, 'facebook', caption, link, parshaSlug);
      if (!res.ok) setError(res.error ?? 'Could not save the link');
      else setReelLink('');
    });
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

        {isManualPost ? (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{post?.caption ?? caption}</div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-500)', marginBottom: 6 }}>Replace reel link</label>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Paste the new reel link"
              defaultValue={postUrl ?? ''}
              onChange={(e) => setReelLink(e.target.value)}
              style={{ width: '100%', minHeight: 44, fontSize: 14, border: '1px solid var(--ink-100)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => markPosted(reelLink || postUrl || '')}
              disabled={posting}
              style={{ ...btnPrimary, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}
            >
              {posting ? 'Saving…' : 'Update link'}
            </button>
          </>
        ) : editFlowOpen ? (
          <>
            <CaptionAndHashtags storageKey={`caption.facebook.${parshaSlug}.edit`} initialCombined={post?.caption ?? caption} onSave={async (next) => savePlatformCaption(jobId, 'facebook', next, parshaSlug)} />
            <ReelOrPostToggle value={reelOrPost} onChange={(v) => { setReelOrPost(v); saveFBMeta(v, firstComment); }} />
            <EditableField storageKey={`facebook.${parshaSlug}.firstComment.edit`} label="First comment" initialValue={firstComment} onSave={async (v) => { setFirstComment(v); await saveFBMeta(reelOrPost, v); }} multiline={false} />
            <button type="button" onClick={() => { startPosting(async () => { const res = await editPostedOnPlatform(videoId, 'facebook', caption); if (!res.ok) setError(res.error ?? 'Update failed'); else setEditFlowOpen(false); }); }} disabled={posting}
              style={{ ...btnPrimary, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 6 }}>
              {posting ? 'Updating…' : 'Update on Facebook'}
            </button>
            <button type="button" onClick={() => setEditFlowOpen(false)} style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--ink-500)', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{post?.caption ?? caption}</div>
            <button type="button" onClick={() => setEditConfirmOpen(true)}
              style={{ ...btnSecondary, cursor: 'pointer' }}>
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setMode('manual')}
          style={{
            flex: 1,
            minHeight: 44,
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            cursor: 'pointer',
            background: mode === 'manual' ? 'var(--navy-700)' : 'white',
            color: mode === 'manual' ? 'var(--linen-50)' : 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
          }}
        >
          Post manually on Facebook
        </button>
        <button
          type="button"
          onClick={() => setMode('buffer')}
          style={{
            flex: 1,
            minHeight: 44,
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            cursor: 'pointer',
            background: mode === 'buffer' ? 'var(--navy-700)' : 'white',
            color: mode === 'buffer' ? 'var(--linen-50)' : 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
          }}
        >
          Post via Buffer
        </button>
      </div>

      {mode === 'manual' ? (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-500)', margin: '0 0 12px' }}>
            Manual reels are currently reaching far more people.
          </p>
          {videoMp4Url ? (
            <a
              href={downloadUrl(videoMp4Url, `torah-tai-chi-${parshaSlug}.mp4`)}
              download
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...btnPrimary, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box', marginBottom: 8 }}
            >
              Download video
            </a>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>Video file is not ready to download yet.</div>
          )}
          <button type="button" onClick={copyCaption} style={{ ...btnSecondary, cursor: 'pointer', marginBottom: 12 }}>
            {copied ? 'Copied' : 'Copy caption'}
          </button>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-500)', marginBottom: 6 }}>Paste the reel link</label>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://www.facebook.com/reel/…"
            value={reelLink}
            onChange={(e) => setReelLink(e.target.value)}
            style={{ width: '100%', minHeight: 44, fontSize: 16, border: '1px solid var(--ink-100)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, boxSizing: 'border-box' }}
          />
          {isFailed && <FailureBanner errorMessage={post?.error_message ?? null} />}
          {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}
          <button
            type="button"
            onClick={() => markPosted(reelLink)}
            disabled={posting || !reelLink.trim()}
            style={{ ...btnPrimary, cursor: posting || !reelLink.trim() ? 'not-allowed' : 'pointer', opacity: posting || !reelLink.trim() ? 0.7 : 1 }}
          >
            {posting ? 'Saving…' : 'Mark as posted'}
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </UnpostedCardShell>
  );
}
