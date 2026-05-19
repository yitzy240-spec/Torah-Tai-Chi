// dashboard/src/app/videos/[slug]/_components/live-at-rest-connected.tsx
//
// Thin client wrapper for LiveAtRest that wires the Replace flow.
// The server component (page-new.tsx) passes parshaId + sourceScriptId as props
// so this component can call replaceVersion then navigate to Phase 1.
//
// B2 expansion: also threads through the site CMS fields + per-platform card data.
// Mirrors the Phase5PostConnected pattern: data in from server, callbacks out to client.

'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LiveAtRest } from './live-at-rest';
import type { PlatformStatus, LiveAtRestPost } from './live-at-rest';
import { replaceVersion } from '@/app/actions/video-page/replace-version';
import type { Platform } from '@/lib/platforms';

interface SocialMeta {
  instagram?: { type: 'reel' | 'post'; firstComment?: string };
  facebook?: { type: 'reel' | 'post'; firstComment?: string };
}

interface Props {
  parshaName: string;
  parshaId: string;
  sourceScriptId: string;
  versionLabel: string;
  videoMp4Url: string;
  thumbPath: string | null;
  websiteUrl: string;
  /** The BIG heading — the creative script title ("In the Desert…") */
  displayTitle: string;
  /** The smaller attribution line — the parsha name ("Bamidbar") */
  attribution: string;
  publishedToWebsiteSince: string | null;
  platforms: PlatformStatus[];
  parshaSlug: string;

  // B2: video ID
  videoId: string;

  // B2: site CMS fields
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteWebsiteCaption: string;
  siteSpokenScript: string;

  // B2: per-platform cards
  liveJobId: string | null;
  captions: Record<string, string>;
  youtubeTags: string[];
  socialMetadata: SocialMeta | null;
  initialPosts: LiveAtRestPost[];
  postUrls: Record<string, string>;
  connectedPlatforms: Platform[];
}

export function LiveAtRestConnected({
  parshaName,
  parshaId,
  sourceScriptId,
  versionLabel,
  videoMp4Url,
  thumbPath,
  websiteUrl,
  displayTitle,
  attribution,
  publishedToWebsiteSince,
  platforms,
  parshaSlug,
  videoId,
  siteTitle,
  siteSubtitle,
  siteDescription,
  siteWebsiteCaption,
  siteSpokenScript,
  liveJobId,
  captions,
  youtubeTags,
  socialMetadata,
  initialPosts,
  postUrls,
  connectedPlatforms,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleReplace() {
    setError(null);
    startTransition(async () => {
      try {
        // Clone the live script into a fresh draft row, then navigate to Phase 1.
        await replaceVersion(parshaId, sourceScriptId, parshaSlug);
        // The revalidatePath in replaceVersion busts the server cache.
        // Push to Phase 1 — page-state will detect the new script as a fresh draft.
        router.push(`/videos/${parshaSlug}?phase=1`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      {error && (
        <p style={{ fontSize: 13, color: 'var(--tassel)', marginBottom: 12 }}>{error}</p>
      )}
      {isPending && (
        <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>Starting new draft…</p>
      )}
      <LiveAtRest
        parshaName={parshaName}
        versionLabel={versionLabel}
        videoMp4Url={videoMp4Url}
        thumbPath={thumbPath}
        websiteUrl={websiteUrl}
        displayTitle={displayTitle}
        attribution={attribution}
        publishedToWebsiteSince={publishedToWebsiteSince}
        platforms={platforms}
        onReplace={handleReplace}
        videoId={videoId}
        parshaSlug={parshaSlug}
        siteTitle={siteTitle}
        siteSubtitle={siteSubtitle}
        siteDescription={siteDescription}
        siteWebsiteCaption={siteWebsiteCaption}
        siteSpokenScript={siteSpokenScript}
        liveJobId={liveJobId}
        captions={captions}
        youtubeTags={youtubeTags}
        socialMetadata={socialMetadata}
        initialPosts={initialPosts}
        postUrls={postUrls}
        connectedPlatforms={connectedPlatforms}
      />
    </>
  );
}
