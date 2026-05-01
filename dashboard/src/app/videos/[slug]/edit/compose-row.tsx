'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { composeVideo } from '@/app/actions/compose-video';

interface Props {
  referenceJobId: string;
  /** clipIds in slot order (index 0..N-1). */
  selectedClipIds: string[];
  totalSlots: number;
}

export function ComposeRow({ referenceJobId, selectedClipIds, totalSlots }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const ready = selectedClipIds.length === totalSlots
    && selectedClipIds.every(Boolean);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await composeVideo({
        referenceJobId, clipIds: selectedClipIds,
      });
      if ('error' in r) {
        setError(r.error);
        return;
      }
      router.push(`/videos`);
    });
  };

  return (
    <section className="border-t pt-4 mt-6 space-y-2">
      <h2 className="text-lg font-semibold">Compose final video</h2>
      <p className="text-sm text-gray-600">
        Pick one version per clip from the cards above, then stitch.
        {!ready && (
          <span className="text-amber-600">
            {' '}(Select a version for every slot.)
          </span>
        )}
      </p>
      <button
        onClick={submit}
        disabled={!ready || pending}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {pending ? 'Stitching\u2026' : 'Compose'}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </section>
  );
}
