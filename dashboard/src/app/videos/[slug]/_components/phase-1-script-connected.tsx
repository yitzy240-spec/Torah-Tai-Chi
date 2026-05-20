// dashboard/src/app/videos/[slug]/_components/phase-1-script-connected.tsx
//
// Thin client wrapper that wires Phase1Script's onAdvance callback to
// triggerPlanOnly. Kept separate so Phase1Script stays a pure-UI component
// (no direct action dependency) and page-new.tsx (server component) can
// pass down IDs without passing server-action callbacks directly (which
// Next.js App Router does support, but this keeps concerns cleaner).
//
// In M4 this will be replaced with a proper phase-nav state machine that
// updates URL / phase cookie without a full page reload.

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Phase1Script } from './phase-1-script';
import { triggerPlanOnly } from '@/app/actions/video-page/trigger-plan-only';

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
  const [advancing, setAdvancing] = useState(false);

  function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    // Navigate IMMEDIATELY — don't make the user wait on the action.
    // Phase 2 renders a "starting…" placeholder while the action runs
    // in the background; once the job row exists, router.refresh swaps
    // in the PlanGeneratingCard.
    router.push(`/videos/${parshaSlug}?phase=2`);
    // Fire the action in the background; do NOT await here.
    triggerPlanOnly(parshaId, scriptId)
      .then((result) => {
        if (!result.ok) {
          toast.error("Couldn't start the clip plan.", { description: result.error });
        } else {
          // Job row exists — re-fetch so PlanGeneratingCard sees it.
          router.refresh();
        }
      })
      .catch((e) => {
        toast.error("Couldn't start the clip plan.", { description: (e as Error).message });
      })
      .finally(() => {
        setAdvancing(false);
      });
  }

  return (
    <Phase1Script
      parshaSlug={parshaSlug}
      scripts={scripts}
      defaultScript={defaultScript}
      onAdvance={handleAdvance}
      advancing={advancing}
    />
  );
}
