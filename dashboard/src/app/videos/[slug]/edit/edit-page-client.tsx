'use client';
import { useState } from 'react';
import { ClipCard } from './clip-card';
import { ComposeRow } from './compose-row';
import { publicClipUrl } from '@/lib/storage-url';
import type { ClipVersion } from '@/lib/clip-versions';

interface Props {
  parshaName: string;
  representativeJobId: string;
  /** Sorted slot indices (0..N-1). */
  indices: number[];
  /** All versions per slot, oldest -> newest. */
  versionsByIndex: Record<number, ClipVersion[]>;
  /** A representative video id for the parsha, used as the
   *  videoId argument when submitting per-clip feedback. The action
   *  pulls parent_job_id from this video, so any video belonging to a
   *  done job in the parsha works — the latest done one. */
  representativeVideoId: string;
}

export function EditPageClient({
  parshaName, representativeJobId, indices,
  versionsByIndex, representativeVideoId,
}: Props) {
  const defaultSelection = indices.map(i => {
    const versions = versionsByIndex[i];
    return versions[versions.length - 1].clipId;
  });
  const [selection, setSelection] = useState<string[]>(defaultSelection);

  const updateSlot = (slotIdx: number, clipId: string) => {
    setSelection(prev => {
      const next = [...prev];
      next[slotIdx] = clipId;
      return next;
    });
  };

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Edit clips: {parshaName}</h1>
        <p className="text-sm text-gray-600">
          Each card shows the latest version of one clip. Submit feedback
          to regenerate just that clip. Then pick one version per clip and
          stitch them into a final video.
        </p>
      </header>

      {indices.map((i, slotIdx) => (
        <ClipCard
          key={i}
          videoId={representativeVideoId}
          index={i}
          versions={versionsByIndex[i]}
          storageUrl={publicClipUrl}
          selectedClipId={selection[slotIdx]}
          onSelect={(clipId) => updateSlot(slotIdx, clipId)}
        />
      ))}

      <ComposeRow
        referenceJobId={representativeJobId}
        selectedClipIds={selection}
        totalSlots={indices.length}
      />
    </main>
  );
}
