// dashboard/src/app/videos/[slug]/_components/phase-5-post-connected.tsx
//
// Thin client wrapper that provides navigation callbacks to Phase5Post.
// Keeps the server/client boundary clean — all data serialized from page-new.tsx server component.

'use client';
import { Phase5Post } from './phase-5-post';
import type { Platform } from '@/lib/platforms';

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
  function handleBack() {
    window.location.reload();
  }

  function handleSiteReplace() {
    // Full Replace flow is M6 scope. For now reload — page state will detect
    // the new draft and route to Phase 1 once Replace flow creates the draft.
    window.location.reload();
  }

  return (
    <Phase5Post
      {...props}
      onBack={handleBack}
      onSiteReplace={handleSiteReplace}
    />
  );
}
