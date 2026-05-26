// dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx
//
// Post-status source-of-truth: useRealtimeRow on the posts row (by post.id).
// Parent (phase-5-post.tsx) also runs useRealtimeRows on the posts table
// filtered by video_id, so the prop already updates live; the per-card
// useRealtimeRow here is defense-in-depth: it survives any future change
// to the parent and includes a 10s defensive poll if websocket drops.
// effectiveStatus = livePost?.status ?? post?.status ?? null.
//
// Fields: title (clip_plans.captions.youtube_title) + description (youtube_description)
//   + tags (clip_plans.youtube_tags, editable comma-separated) + cover thumbnail (FramePicker).
// YouTube is direct via lib/youtube.ts — not through Buffer.
// edit flow: YouTube Data API supports videos.update cleanly → no unpost/repost regardless of EDITPOST_BRANCH.

'use client';
import { useState, useTransition } from 'react';
import { EditableField } from './_shared/editable-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { FramePicker } from './_shared/frame-picker';
import { ScheduleForLaterSheet } from './_shared/schedule-for-later-sheet';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { saveSocialMetadata } from '@/app/actions/video-page/save-social-metadata';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { saveYouTubeThumbnail } from '@/app/actions/video-page/save-youtube-thumbnail';
import { useRealtimeRow } from '@/hooks/use-realtime-row';

interface PostRow {
  id: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  caption: string | null;
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
  initialThumbUrl: string | null;
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
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pickedThumbUrl, setPickedThumbUrl] = useState<string | null>(null);
  const [tagsInput, setTagsInput] = useState(youtubeTags.join(', '));
  const [posting, startPosting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Subscribe to this card's posts row so a late 'failed' status (YouTube
  // reject, async upload worker failure) lands without manual refresh.
  const livePost = useRealtimeRow<PostRow>('posts', post?.id ?? null, post ?? null);
  const effectiveStatus = livePost?.status ?? post?.status ?? null;

  const isPosted = effectiveStatus === 'published';
  const isScheduled = effectiveStatus === 'scheduled';

  async function saveTags(raw: string) {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    await saveSocialMetadata(jobId, { youtube_tags: tags });
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
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>▶️ YouTube · Scheduled</div>
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
        icon="▶️"
        platform="YouTube"
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
            <strong style={{ fontSize: 13 }}>▶️ YouTube</strong>
            <span style={{ fontSize: 11, color: 'var(--jade)', marginLeft: 6 }}>● Posted</span>
          </div>
          <button type="button" onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 18 }}>▴</button>
        </div>
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
      const res = await postToPlatform(videoId, 'youtube', { youtube: captionForPost }, { shareNow: true });
      if (!res.ok) setError(res.error ?? 'Post failed');
    });
  }

  return (
    <div style={{ border: '1.5px solid var(--navy-700)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'white' }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>
        ▶️ YouTube Short · next up
      </div>

      <EditableField
        storageKey={`caption.youtube_title.${parshaSlug}`}
        label="Title"
        initialValue={youtubeTitle}
        onSave={(v) => savePlatformCaption(jobId, 'youtube_title', v)}
        multiline={false}
        placeholder="Torah Tai Chi — Bamidbar"
      />
      <EditableField
        storageKey={`caption.youtube_description.${parshaSlug}`}
        label="Description"
        initialValue={youtubeDescription}
        onSave={(v) => savePlatformCaption(jobId, 'youtube_description', v)}
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

      {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>}

      <button type="button" onClick={onPost} disabled={posting}
        style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, marginBottom: 8 }}>
        {posting ? 'Uploading to YouTube…' : 'Post to YouTube'}
      </button>

      <button type="button" onClick={() => setScheduleOpen(true)}
        style={{ width: '100%', minHeight: 44, fontSize: 13, background: 'transparent', color: 'var(--navy-700)', border: '1px solid var(--ink-100)', borderRadius: 8, cursor: 'pointer' }}>
        Schedule for later
      </button>

      <ScheduleForLaterSheet open={scheduleOpen} onOpenChange={setScheduleOpen} platform="YouTube"
        onSchedule={async (when) => {
          const res = await postToPlatform(videoId, 'youtube', { youtube: captionForPost }, { scheduledAt: when, shareNow: false });
          if (!res.ok) setError(res.error ?? 'Schedule failed');
        }} />
    </div>
  );
}
