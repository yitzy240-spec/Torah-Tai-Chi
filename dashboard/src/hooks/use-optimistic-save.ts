// dashboard/src/hooks/use-optimistic-save.ts
//
// Wraps a server action so the UI updates instantly. On failure,
// reverts the local value and shows a toast (sonner). Pairs with
// useLocalStorageDraft for "edit -> instant feedback -> save in bg".
//
// Trailing debounce (added 2026-06-04 after Buffer rate-limit incident):
// every keystroke calls `update(next)` which updates local state immediately
// but schedules the server save with a 400ms trailing debounce. For a
// 50-char caption edit at normal typing speed, that's ~3 server calls
// instead of 50. The Buffer cache-tag fix in commit 731007f stopped the
// keystroke-cache-bust storm from blowing the 100/day rate limit; this
// debounce is the second layer of defense — cutting the per-edit work
// regardless of which downstream code happens to be cache-sensitive.
//
// `isPending` reflects "save is queued OR in flight" so callers using the
// "await isPending before regen" pattern (per commit 5b0b14c per kickoff)
// stay correct — a debounced-but-not-yet-fired save still counts as pending.

'use client';
import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export interface OptimisticSaveOptions<V> {
  current: V;
  save: (next: V) => Promise<void>;
  onSuccess?: () => void;
  errorMessage?: string;
  /** Trailing debounce in ms. Defaults to 400. Set to 0 to disable
   *  (fires save synchronously on each update — original v1 behavior). */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 400;

export function useOptimisticSave<V>({
  current,
  save,
  onSuccess,
  errorMessage,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: OptimisticSaveOptions<V>) {
  const [local, setLocal] = useState<V>(current);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isInFlight, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef<V>(current);
  // Pinned to the latest props via the effect below, so the timer callback
  // never closes over stale `save`/`current`/`onSuccess`/`errorMessage`.
  const saveRef = useRef(save);
  const currentRef = useRef(current);
  const onSuccessRef = useRef(onSuccess);
  const errorMessageRef = useRef(errorMessage);
  useEffect(() => {
    saveRef.current = save;
    currentRef.current = current;
    onSuccessRef.current = onSuccess;
    errorMessageRef.current = errorMessage;
  });

  // Cleanup on unmount — don't fire a save after the component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const update = useCallback((next: V) => {
    setLocal(next);
    setIsDirty(true);
    latestValueRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startTransition(async () => {
        try {
          await saveRef.current(latestValueRef.current);
          setSavedAt(new Date());
          onSuccessRef.current?.();
        } catch (e) {
          setLocal(currentRef.current);
          toast.error(
            errorMessageRef.current ?? "Couldn't save — your change was reverted.",
            { description: (e as Error).message },
          );
        } finally {
          setIsDirty(false);
        }
      });
    }, debounceMs);
  }, [debounceMs]);

  // True from the first keystroke until the eventual save resolves.
  // Callers using "await isPending before regen" (per commit 5b0b14c)
  // remain correct: a debounced-but-not-yet-fired save still counts.
  const isPending = isDirty || isInFlight;

  return { value: local, update, isPending, savedAt };
}
