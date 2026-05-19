// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/hashtag-field.tsx
//
// Splits a flat caption string into body + hashtags (UI convenience).
// On save, concatenates them back into the flat string the backend stores.
// Uses EditableField underneath.
//
// The flat string remains canonical — hashtag split is presentation only.

'use client';
import { useMemo } from 'react';
import { EditableField } from './editable-field';

interface Props {
  storageKey: string;
  initialCombined: string;
  onSave: (combined: string) => Promise<void>;
}

export function CaptionAndHashtags({ storageKey, initialCombined, onSave }: Props) {
  const { body: initBody, tags: initTags } = useMemo(() => splitCaption(initialCombined), [initialCombined]);

  return (
    <>
      <EditableField
        storageKey={`${storageKey}.body`}
        label="Caption"
        initialValue={initBody}
        onSave={async (b) => onSave(joinCaption(b, initTags))}
        minHeight={80}
      />
      <EditableField
        storageKey={`${storageKey}.tags`}
        label="Hashtags"
        initialValue={initTags}
        onSave={async (t) => onSave(joinCaption(initBody, t))}
        multiline={false}
        placeholder="#Torah #TaiChi #Shorts"
      />
    </>
  );
}

function splitCaption(s: string): { body: string; tags: string } {
  // Find trailing hashtag block (handles multiline without the /s flag)
  const m = s.match(/^([\s\S]*?)(?:\n+)?((?:#[\w_]+\s*)+)$/);
  if (!m) return { body: s, tags: '' };
  return { body: m[1].trim(), tags: m[2].trim() };
}

function joinCaption(body: string, tags: string): string {
  return tags ? `${body}\n\n${tags}` : body;
}
