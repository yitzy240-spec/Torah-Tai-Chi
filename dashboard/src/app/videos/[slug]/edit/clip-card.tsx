'use client';
import { useState, useTransition } from 'react';
import { submitClipFeedback } from '@/app/actions/submit-clip-feedback';
import type { ClipVersion } from '@/lib/clip-versions';

interface Props {
  videoId: string;
  index: number;
  versions: ClipVersion[]; // oldest -> newest
  storageUrl: (path: string) => string;
  selectedClipId: string;
  onSelect: (clipId: string) => void;
}

export function ClipCard({
  videoId, index, versions, storageUrl, selectedClipId, onSelect,
}: Props) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submittedMsg, setSubmittedMsg] = useState<string | null>(null);
  const latest = versions[versions.length - 1];

  const submit = () => {
    setError(null);
    setSubmittedMsg(null);
    startTransition(async () => {
      const r = await submitClipFeedback({
        videoId, clipId: latest.clipId, text,
      });
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setText('');
      setSubmittedMsg(
        'Queued. The new version will appear here when it\u2019s ready.',
      );
    });
  };

  const sel = versions.find(v => v.clipId === selectedClipId) ?? latest;

  return (
    <section className="border rounded-lg p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Clip {index + 1}</h2>
        <span className="text-sm text-gray-500">
          {versions.length} version{versions.length === 1 ? '' : 's'}
        </span>
      </header>

      {sel.storagePath ? (
        <video
          controls
          src={storageUrl(sel.storagePath)}
          className="w-full rounded"
        />
      ) : (
        <div className="text-gray-400">No preview available.</div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">Fix this clip</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What needs to change in this clip? (e.g. say Shabbat as &lsquo;Shab-baht&rsquo;)"
          className="w-full border rounded p-2 text-sm"
          rows={2}
          disabled={pending}
        />
        <button
          onClick={submit}
          disabled={pending || text.trim().length === 0}
          className="px-3 py-1.5 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {pending ? 'Queuing\u2026' : 'Regenerate this clip'}
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {submittedMsg && <p className="text-green-700 text-sm">{submittedMsg}</p>}
      </div>

      {versions.length > 1 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Versions</p>
          <div className="flex gap-2 overflow-x-auto">
            {versions.map((v, i) => {
              const isSelected = v.clipId === selectedClipId;
              return (
                <button
                  key={v.clipId}
                  onClick={() => onSelect(v.clipId)}
                  className={
                    'flex-shrink-0 w-32 border-2 rounded p-1 text-xs text-left ' +
                    (isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200')
                  }
                >
                  <div className="truncate">v{i + 1}</div>
                  <div className="truncate text-gray-500">
                    {new Date(v.createdAt).toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
