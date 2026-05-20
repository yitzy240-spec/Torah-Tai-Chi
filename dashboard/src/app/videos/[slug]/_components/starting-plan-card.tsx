// dashboard/src/app/videos/[slug]/_components/starting-plan-card.tsx
//
// Renders on Phase 2 when the user just navigated from Phase 1 with
// ?start_plan=1 and no plan-only job exists yet.
//
// On mount: calls triggerPlanOnly to insert the job row. Once the
// action returns, replaces the URL (strips ?start_plan=1) and
// refreshes so the page picks up the new job and PlanGeneratingCard
// takes over.
//
// Why this lives on Phase 2 (not Phase 1): calling a server action from
// a Phase 1 click handler made Next.js block the router transition
// until the action returned, producing an 8-second navigation hang.
// Moving the action call to Phase 2's mount decouples the navigation
// from the action entirely — Phase 1 click is now pure router.push.

'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { triggerPlanOnly } from '@/app/actions/video-page/trigger-plan-only';

interface Props {
  parshaId: string;
  scriptId: string;
  parshaSlug: string;
}

export function StartingPlanCard({ parshaId, scriptId, parshaSlug }: Props) {
  const router = useRouter();
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    triggerPlanOnly(parshaId, scriptId)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          toast.error("Couldn't start the clip plan.", { description: result.error });
          return;
        }
        // Job row exists. Drop the ?start_plan=1 intent from the URL
        // so a refresh doesn't re-fire, then refresh so the page picks
        // up the new job and PlanGeneratingCard takes over.
        router.replace(`/videos/${parshaSlug}?phase=2`);
        router.refresh();
      })
      .catch((e) => {
        const msg = (e as Error).message;
        setError(msg);
        toast.error("Couldn't start the clip plan.", { description: msg });
      });
  }, [parshaId, scriptId, parshaSlug, router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        minHeight: 240,
        background: 'var(--linen-50)',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        textAlign: 'center',
      }}
    >
      {error ? (
        <>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--tassel)',
              color: 'white',
              fontSize: 22,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            !
          </div>
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--ink-900)',
              marginBottom: 8,
            }}
          >
            Couldn&apos;t start the clip plan
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5 }}>
            {error}
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              firedRef.current = false;
              router.refresh();
            }}
            style={{
              marginTop: 18,
              minHeight: 40,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 500,
              background: 'white',
              color: 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '3px solid var(--ink-100)',
              borderTopColor: 'var(--navy-700)',
              animation: 'spin 0.9s linear infinite',
              marginBottom: 18,
            }}
          />
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--ink-900)',
              marginBottom: 8,
            }}
          >
            Reading the script…
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5 }}>
            Claude is breaking your script into clip-by-clip voiceover and scene direction.
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}
    </div>
  );
}
