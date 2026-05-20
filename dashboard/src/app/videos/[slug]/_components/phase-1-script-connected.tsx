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
  // parshaId is intentionally not in the URL — Phase 2 looks it up
  // from the slug. Only scriptId travels through, since the operator
  // may have multiple scripts and we need to know which one to plan.
  void parshaId;
  const nextUrl =
    `/videos/${parshaSlug}?phase=2&start_plan=1&script=${encodeURIComponent(scriptId)}`;

  // Prefetch the Phase 2 URL so router.push is instant on click.
  useEffect(() => {
    router.prefetch(nextUrl);
  }, [router, nextUrl]);

  function handleAdvance() {
    router.push(nextUrl);
  }

  return (
    <Phase1Script
      parshaSlug={parshaSlug}
      scripts={scripts}
      defaultScript={defaultScript}
      onAdvance={handleAdvance}
      advancing={false}
    />
  );
}
