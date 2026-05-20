// dashboard/src/app/videos/[slug]/_components/empty-state.tsx
//
// Single-CTA card for the "empty" page state (no scripts, no video, nothing live).
// Per spec §3 table: "Empty — Single CTA: Start your video".
//
// On click: calls startFromEmpty, which ensures a placeholder script row exists
// for this parsha and returns. No Modal call, no AI generation, no cost. The
// user lands in Phase 1 with an empty editor and types (or generates AI
// variants via an explicit opt-in tab inside Phase 1).

'use client';
import { useState, useTransition } from 'react';
import { startFromEmpty } from '@/app/actions/video-page/start-from-empty';
import { useRouter } from 'next/navigation';

interface Props {
  parshaName: string;
  parshaId: string;
  parshaSlug: string;
}

export function EmptyState({ parshaName, parshaId, parshaSlug }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const result = await startFromEmpty(parshaId, parshaSlug);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Route to Phase 1 — page-state will detect the queued job and render the script editor.
      router.push(`/videos/${parshaSlug}?phase=1`);
      router.refresh();
    });
  }

  return (
    <section
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        border: '1px solid var(--ink-100)',
        borderRadius: 12,
        background: 'white',
        marginTop: 24,
      }}
    >
      <p
        style={{
          fontSize: 15,
          color: 'var(--ink-700)',
          marginBottom: 24,
          lineHeight: 1.5,
          maxWidth: 380,
          marginInline: 'auto',
        }}
      >
        {parshaName} doesn&apos;t have a video yet. Start scripting now
      </p>

      {error && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--tassel)',
            marginBottom: 16,
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleStart}
        disabled={isPending}
        style={{
          minHeight: 48,
          fontSize: 15,
          fontWeight: 500,
          background: isPending ? 'var(--ink-300)' : 'var(--navy-700)',
          color: 'var(--linen-50)',
          border: 'none',
          borderRadius: 10,
          padding: '14px 28px',
          cursor: isPending ? 'not-allowed' : 'pointer',
          transition: 'var(--trans)',
        }}
      >
        {isPending ? 'Starting…' : 'Start scripting'}
      </button>
    </section>
  );
}
