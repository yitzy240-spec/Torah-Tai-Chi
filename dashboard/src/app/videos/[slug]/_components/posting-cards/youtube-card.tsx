// dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx
//
// Post-status source-of-truth: post prop from parent (phase-5-post.tsx).
// Parent runs useRealtimeRows on the posts table filtered by video_id, so
// the prop already updates live. Per-card useRealtimeRow removed as part of
// the shared-sub-components migration (Task 6 / Phase 2).
// effectiveStatus = post?.status ?? null.
//
// Fields: title (clip_plans.captions.youtube_title) + description (youtube_description)
//   + tags (clip_plans.youtube_tags, editable comma-separated) + cover thumbnail (FramePicker).
// YouTube is direct via lib/youtube.ts — not through Buffer.
// No inline edit flow — YouTube Data API supports videos.update cleanly;
// operator edits go through YouTube Studio directly.

'use client';
import { useState, useTransition } from 'react';
import { EditableField } from './_shared/editable-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { FramePicker } from './_shared/frame-picker';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { ScheduledStateCard } from './_shared/scheduled-state-card';
import { PostedExpandedHeader } from './_shared/posted-expanded-header';
import { FailureBanner } from './_shared/failure-banner';
import { PostActionButtons } from './_shared/post-action-buttons';
import { UnpostedCardShell } from './_shared/unposted-card-shell';
import { PlatformIcon } from '@/components/platform-icon';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { saveSocialMetadata } from '@/app/actions/video-page/save-social-metadata';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { saveYouTubeThumbnail } from '@/app/actions/video-page/save-youtube-thumbnail';

interface PostRow {
  id: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  /**
   * For YouTube posts this column is repurposed to hold the YouTube video ID
   * (see lib/auto-post.ts where it's set to ytVideo.id). Used to deep-link
   * the operator into YouTube Studio to edit or cancel a scheduled upload.
   */
  buffer_update_id: string | null;
  caption: string | null;
  error_message: string | null;
}

interface Props {
  jobId: string;
  videoId: string;
  parshaSlug: string;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubeTags: string[];    // current tags from clip_plans.youtube_tags
  post: PostRow | null;
  postUrl: string | null;
  videoMp4Url: string | null;   // for the frame picker
  /** Auto-extracted stitch-time thumb (videos.thumb_path), shown in the
   *  FramePicker preview when the operator hasn't picked a custom frame. */
  initialThumbUrl: string | null;
  /** Operator's previously persisted YouTube cover frame
   *  (videos.youtube_thumbnail_url). Seeds pickedThumbUrl so a reload
   *  doesn't silently drop the pick. Null = no prior pick — falls back
   *  to initialThumbUrl in the picker preview, and autoPost falls back
   *  to videos.thumb_path at upload time. */
  initialPickedThumbUrl?: string | null;
}

export function YouTubeCard({
  jobId,
  videoId,
  parshaSlug,
  youtubeTitle,
  youtubeDescription,
  youtubeTags,
  post,
  postUrl,
  videoMp4Url,
  initialThumbUrl,
  initialPickedThumbUrl = null,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Seeded from videos.youtube_thumbnail_url so the picker reflects
  // the saved choice after a reload. Updated locally on a fresh pick
  // (saveYouTubeThumbnail also persists in the same call).
  const [pickedThumbUrl, setPickedThumbUrl] = useState<string | null>(initialPickedThumbUrl);
  const [tagsInput, setTagsInput] = useState(youtubeTags.join(', '));
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = post?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';
  const isFailed = effectiveStatus === 'failed';

  async function saveTags(raw: string) {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    await saveSocialMetadata(jobId, { youtube_tags: tags }, parshaSlug);
  }

  async function handlePickFrame(blob: Blob): Promise<void> {
    // Convert blob to base64 for server action
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const { url } = await saveYouTubeThumbnail(videoId, base64);
    setPickedThumbUrl(url);
  }

  // Scheduled state
  if (isScheduled && post) {
    return (
      <ScheduledStateCard
        platformName="YouTube"
        icon={<PlatformIcon name="youtube" size={14} />}
        scheduledAt={post.scheduled_at}
        bufferUpdateId={post.buffer_update_id}
        externalEditUrl={(id) => `https://studio.youtube.com/video/${id}/edit`}
        externalListUrl="https://studio.youtube.com/"
        editLabel="Edit or cancel in YouTube Studio →"
        listLabel="Open YouTube Studio to cancel →"
      />
    );
  }

  if (isPosted && !expanded) {
    return (
      <PostedSummaryRow
        icon={<PlatformIcon name="youtube" size={14} />}
        platform="YouTube"
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
          platformName="YouTube"
          icon={<PlatformIcon name="youtube" size={14} />}
          onCollapse={() => setExpanded(false)}
        />
        <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 8 }}>
          <strong>{post?.caption ?? youtubeTitle}</strong>
        </div>
        {postUrl && (
          <a href={postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--navy-700)', textDecoration: 'underline' }}>
            View on YouTube →
          </a>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-500)' }}>
          YouTube videos can be edited directly in YouTube Studio.
        </div>
      </div>
    );
  }

  // Unposted: editable
  const captionForPost = youtubeTitle + (youtubeDescription ? '\n' + youtubeDescription : '');

  async function onPost() {
    setError(null);
    startPosting(async () => {
      const res = await postToPlatform(
        videoId,
        'youtube',
        { youtube: captionForPost },
        {
          shareNow: true,
          // Operator's hand-picked cover frame (uploaded via the
          // FramePicker → saveYouTubeThumbnail flow). When null, autoPost
          // falls back to videos.thumb_path (auto-extracted at stitch).
          youtubeThumbnailUrl: pickedThumbUrl ?? undefined,
        },
      );
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <UnpostedCardShell
      platformName="YouTube"
      icon={<PlatformIcon name="youtube" size={14} />}
      suffix="Short · next up"
    >
      <EditableField
        storageKey={`caption.youtube_title.${parshaSlug}`}
        label="Title"
        initialValue={youtubeTitle}
        onSave={(v) => savePlatformCaption(jobId, 'youtube_title', v, parshaSlug)}
        multiline={false}
        placeholder="Torah Tai Chi — Bamidbar"
      />
      <EditableField
        storageKey={`caption.youtube_description.${parshaSlug}`}
        label="Description"
        initialValue={youtubeDescription}
        onSave={(v) => savePlatformCaption(jobId, 'youtube_description', v, parshaSlug)}
        minHeight={80}
        placeholder="Short + description…"
      />

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}>
          Tags (comma-separated)
        </label>
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={() => saveTags(tagsInput)}
          placeholder="Torah, Tai Chi, Shorts"
          style={{ width: '100%', minHeight: 44, padding: '8px 10px', fontSize: 16, border: '1px solid var(--ink-100)', borderRadius: 6, boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
      </div>

      {videoMp4Url && (
        <FramePicker
          videoUrl={videoMp4Url}
          initialThumbUrl={pickedThumbUrl ?? initialThumbUrl}
          onPick={handlePickFrame}
        />
      )}

      {isFailed && (
        <FailureBanner errorMessage={post?.error_message ?? null} />
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <PostActionButtons
        posting={posting}
        onPost={onPost}
        onScheduleOpen={() => setScheduleOpen(true)}
        platformName="YouTube"
        postLabel="Post to YouTube"
        postingLabel="Uploading to YouTube…"
      />

      <ScheduleForLaterSheet open={scheduleOpen} onOpenChange={setScheduleOpen} platform="YouTube"
        onSchedule={async (when) => {
          const res = await postToPlatform(
            videoId,
            'youtube',
            { youtube: captionForPost },
            {
              scheduledAt: when,
              shareNow: false,
              youtubeThumbnailUrl: pickedThumbUrl ?? undefined,
            },
          );
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }} />
    </UnpostedCardShell>
  );
}
