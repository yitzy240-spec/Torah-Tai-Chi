// dashboard/src/hooks/use-optimistic-save.ts
//
// Wraps a server action so the UI updates instantly. On failure,
// reverts the local value and shows a toast (sonner). Pairs with
// useLocalStorageDraft for "edit -> instant feedback -> save in bg".
//
// The save-before-render race fix (commit 5b0b14c per kickoff doc) is
// preserved: callers should await any pending save (via isPending) before
// triggering a regen action. The hook intentionally exposes isPending for
// this purpose.

'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface OptimisticSaveOptions<V> {
  current: V;
  save: (next: V) => Promise<void>;
  onSuccess?: () => void;
  errorMessage?: string;
}

export function useOptimisticSave<V>({
  current,
  save,
  onSuccess,
  errorMessage,
}: OptimisticSaveOptions<V>) {
  const [local, setLocal] = useState<V>(current);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(next: V) {
    setLocal(next);
    startTransition(async () => {
      try {
        await save(next);
        setSavedAt(new Date());
        onSuccess?.();
      } catch (e) {
        setLocal(current); // revert to last known-good server value
        toast.error(errorMessage ?? "Couldn't save — your change was reverted.", {
          description: (e as Error).message,
        });
      }
    });
  }

  return { value: local, update, isPending, savedAt };
}
