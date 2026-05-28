// dashboard/src/app/videos/[slug]/_components/phase-1-script-connected.tsx
//
// Thin client wrapper for Phase1Script. The advance button is PURE
// navigation: a router.push with an intent param. NO server action is
// called from here — calling a server action from a client handler
// makes Next.js wrap the call in a transition that blocks the router
// commit until the action returns, which produced 8-second hangs.
//
// The actual plan-only job insert happens on Phase 2 via the
// StartingPlanCard (mounted when ?start_plan=1 is in the URL).
//
// Prefetches the Phase 2 URL on mount so the RSC payload is cached
// when the user clicks Generate.

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Phase1Script } from './phase-1-script';

interface Props {
  parshaSlug: string;
  parshaId: string;
  scriptId: string;
  scripts: Array<{ id: string; option: string; title: string | null; draft_text: string | null }>;
  defaultScript: { id: string; option: string; title: string | null; draft_text: string | null };
}

export function Phase1ScriptConnected({
  parshaSlug,
  parshaId,
  scriptId,
  scripts,
  defaultScript,
}: Props) {
  const router = useRouter();
  // parshaId is forwarded into Phase1Script (Write / From-Idea modes
  // need it to INSERT a new scripts row before advancing). The URL
  // itself still only carries script_id — Phase 2 looks parsha up by
  // slug. The scriptId in the URL comes from whichever mode's onAdvance
  // fires: Pick → selected existing script, Write/FromIdea → freshly
  // inserted custom script's id.

  // Prefetch the default-script Phase 2 URL on mount (common case).
  // If the operator picks an alternate, the actual push uses the
  // updated scriptId — prefetch is a cache hint, not a hard target.
  const prefetchUrl =
    `/videos/${parshaSlug}?phase=2&start_plan=1&script=${encodeURIComponent(scriptId)}`;
  useEffect(() => {
    router.prefetch(prefetchUrl);
  }, [router, prefetchUrl]);

  function handleAdvance(chosenScriptId: string) {
    const nextUrl =
      `/videos/${parshaSlug}?phase=2&start_plan=1&script=${encodeURIComponent(chosenScriptId)}`;
    router.push(nextUrl);
  }

  return (
    <Phase1Script
      parshaSlug={parshaSlug}
      parshaId={parshaId}
      scripts={scripts}
      defaultScript={defaultScript}
      onAdvance={handleAdvance}
      advancing={false}
    />
  );
}
