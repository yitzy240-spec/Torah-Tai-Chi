// dashboard/src/app/videos/[slug]/_components/empty-state.tsx
//
// Single-CTA card for the "empty" page state — parsha has no scripts, no
// video, nothing live. Per spec §3 table: "Empty — Single CTA: Start your
// video".
//
// On click: create the placeholder script row, then navigate to ?phase=1.
//
// Pushing ?phase=1 on its own is NOT enough, and used to make this button do
// visibly nothing: page.tsx returns EmptyState as soon as state.kind is
// 'empty', before it reads the phase param, so navigating to ?phase=1 while
// the parsha still has no script re-renders this very card. The row has to
// exist first — that's what flips the state machine to Phase 1.
//
// startFromEmpty is the same action the home-page cards use. It writes via
// the service-role client, which is what fixed the earlier version of this
// button that hung when RLS blocked an authed insert. It queues no job and
// calls no Modal pipeline — it only creates the row Phase 1 binds to.

'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startFromEmpty } from '@/app/actions/video-page/start-from-empty';

interface Props {
  parshaName: string;
  parshaId: string;
  parshaSlug: string;
}

export function EmptyState({ parshaName, parshaId, parshaSlug }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const res = await startFromEmpty(parshaId, parshaSlug);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/videos/${parshaSlug}?phase=1`);
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
        {`${parshaName} doesn't have a video yet. Start scripting now`}
      </p>

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

      {error && (
        <p
          style={{
            marginTop: 16,
            fontSize: 13,
            color: 'var(--tassel)',
            maxWidth: 380,
            marginInline: 'auto',
          }}
        >
          {error}
        </p>
      )}
    </section>
  );
}
