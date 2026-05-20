// dashboard/src/app/videos/[slug]/_components/empty-state.tsx
//
// Single-CTA card for the "empty" page state — parsha has no scripts, no
// video, nothing live. Per spec §3 table: "Empty — Single CTA: Start your
// video".
//
// On click: navigate to ?phase=1. The page-state machine (hasScripts in
// shell-data) routes parshas with existing scripts directly to Phase 1,
// so this state should only render for parshas where the offline script
// pipeline hasn't populated yet. In that case Phase 1 shows a
// "Generating the script… check back" placeholder.
//
// Note: this button does NOT call any server action. The previous
// implementation tried to insert a placeholder script row and hung
// when RLS blocked the insert.

'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  parshaName: string;
  parshaId: string;
  parshaSlug: string;
}

export function EmptyState({ parshaName, parshaSlug }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleStart() {
    startTransition(() => {
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
    </section>
  );
}
