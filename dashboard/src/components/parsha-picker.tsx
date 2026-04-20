'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { triggerGeneration } from '@/app/actions/trigger-generation';

type Script = { id: string; option: 'A' | 'B' | 'C'; title: string };
type Parsha = {
  id: string; order: number; name: string; book: string; slug: string;
  scripts: Script[];
};

export function ParshaPicker({ parshiot }: { parshiot: Parsha[] }) {
  const router = useRouter();
  const [parshaId, setParshaId] = useState<string>('');
  const [scriptId, setScriptId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const selectedParsha = parshiot.find(p => p.id === parshaId);

  async function handleSubmit() {
    if (!parshaId || !scriptId) return;
    setSubmitting(true);
    const result = await triggerGeneration({ parshaId, scriptId });
    setSubmitting(false);
    if (result.jobId) {
      router.push(`/jobs/${result.jobId}`);
    } else {
      alert(result.error ?? 'Failed to trigger');
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
      <div className="space-y-2">
        <label className="text-sm font-medium">Parsha</label>
        <Select value={parshaId} onValueChange={v => { setParshaId(v ?? ''); setScriptId(''); }}>
          <SelectTrigger><SelectValue placeholder="Choose parsha" /></SelectTrigger>
          <SelectContent>
            {parshiot.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.order}. {p.name} <span className="text-neutral-500">({p.book})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedParsha && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Script option</label>
          <Select value={scriptId} onValueChange={v => setScriptId(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Choose script" /></SelectTrigger>
            <SelectContent>
              {selectedParsha.scripts.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.option}. {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="pt-2">
        <div className="mb-2 text-xs text-neutral-500">Estimated cost: <span className="tabular-nums">$4.90</span></div>
        <Button
          onClick={handleSubmit}
          disabled={!parshaId || !scriptId || submitting}
          className="w-full"
        >
          {submitting ? 'Triggering…' : 'Generate Full Video'}
        </Button>
      </div>
    </div>
  );
}
