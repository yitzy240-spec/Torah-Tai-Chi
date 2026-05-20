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

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      const result = await triggerPlanOnly(parshaId, scriptId);
      if (!result.ok) {
        toast.error("Couldn't start the clip plan.", { description: result.error });
        setAdvancing(false);
        return;
      }
      // Navigate to Phase 2. router.refresh ensures the new job row is
      // picked up by the server fetch on the next render. Also reset
      // advancing so the button can't appear stuck if the soft-nav
      // takes a moment — Phase 1 will unmount once Phase 2 commits.
      router.push(`/videos/${parshaSlug}?phase=2`);
      router.refresh();
      setAdvancing(false);
    } catch (e) {
      toast.error("Couldn't start the clip plan.", { description: (e as Error).message });
      setAdvancing(false);
    }
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
