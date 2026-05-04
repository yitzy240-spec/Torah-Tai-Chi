'use client';

import { useState } from 'react';
import { EditableClipCard, type EditableClipVersion } from './editable-clip-card';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

interface Props {
  videoId: string;
  clipsByIndex: Record<number, EditableClipVersion[]>;
  durationsByIndex: Record<number, number>;
  resolution: Resolution | null;
  modelTier: ModelTier | null;
}

/**
 * Thin client wrapper around the per-index <EditableClipCard> list. Server
 * components can't pass closures across the RSC boundary, so we own the
 * `selectedByIndex` state here and forward an `onSelectVersion` callback
 * into each card. State defaults to the latest version of each clip.
 */
export function EditableClipList({
  videoId,
  clipsByIndex,
  durationsByIndex,
  resolution,
  modelTier,
}: Props) {
  const indices = Object.keys(clipsByIndex).map(Number).sort((a, b) => a - b);
  const totalClips = indices.length;

  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string>>(
    () => {
      const m: Record<number, string> = {};
      for (const idx of indices) {
        const versions = clipsByIndex[idx];
        m[idx] = versions[versions.length - 1].clipId;
      }
      return m;
    },
  );

  return (
    <>
      {indices.map((idx) => {
        const versions = clipsByIndex[idx];
        return (
          <EditableClipCard
            key={`clip-${idx}`}
            videoId={videoId}
            index={idx}
            totalClips={totalClips}
            durationS={durationsByIndex[idx] ?? 0}
            versions={versions}
            selectedClipId={selectedByIndex[idx] ?? versions[versions.length - 1].clipId}
            onSelectVersion={(clipId) =>
              setSelectedByIndex((prev) => ({ ...prev, [idx]: clipId }))
            }
            resolution={resolution}
            modelTier={modelTier}
          />
        );
      })}
    </>
  );
}
