// dashboard/src/app/videos/[slug]/_components/phase-5-post-connected.tsx
//
// Thin client wrapper that provides navigation callbacks to Phase5Post.
// Keeps the server/client boundary clean — all data serialized from page-new.tsx server component.
//
// M6: onSiteReplace now calls the real replaceVersion server action and navigates to Phase 1.
// parshaId + sourceScriptId are passed in from the server so the client doesn't need to know
// the internal IDs independently.

'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phase5Post } from './phase-5-post';
import type { Platform } from '@/lib/platforms';
import { replaceVersion } from '@/app/actions/video-page/replace-version';

interface PostRow {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
}

interface SocialMeta {
  instagram?: { type: 'reel' | 'post'; firstComment?: string };
  facebook?: { type: 'reel' | 'post'; firstComment?: string };
}

interface Props {
  videoId: string;
  parshaSlug: string;
  /** parshaId and sourceScriptId are needed by the Replace flow (M6). */
  parshaId: string;
  sourceScriptId: string;
  isLive: boolean;
  liveSince: string | null;
  liveVersionLabel: string | null;
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  websiteUrl: string;
  jobId: string;
  captions: Record<string, string>;
  youtubeTags: string[];
  socialMetadata: SocialMeta | null;
  initialPosts: PostRow[];
  postUrls: Record<string, string>;
  connectedPlatforms: Platform[];
  videoMp4Url: string | null;
  thumbPath: string | null;
}

export function Phase5PostConnected(props: Props) {
  const [, startTransition] = useTransition();
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const router = useRouter();

  function handleBack() {
    // Navigate back to Phase 4 via URL param so the server re-renders.
    router.push(`/videos/${props.parshaSlug}?continue=1&phase=4`);
  }

  function handleSiteReplace() {
    // Call replaceVersion to clone the current script into a fresh draft,
    // then navigate to Phase 1 to start the review flow.
    setReplaceError(null);
    startTransition(async () => {
      try {
        await replaceVersion(props.parshaId, props.sourceScriptId, props.parshaSlug);
        router.push(`/videos/${props.parshaSlug}?phase=1`);
        router.refresh();
      } catch (e) {
        setReplaceError((e as Error).message);
      }
    });
  }

  return (
    <>
      {replaceError && (
        <p style={{ fontSize: 13, color: 'var(--tassel)', marginBottom: 8 }}>{replaceError}</p>
      )}
      <Phase5Post
        {...props}
        onBack={handleBack}
        onSiteReplace={handleSiteReplace}
      />
    </>
  );
}
