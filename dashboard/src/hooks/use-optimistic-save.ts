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
import {
  isStaleDeployError,
  stashUnsaved,
  readUnsaved,
  clearUnsaved,
  STALE_DEPLOY_MESSAGE,
  STALE_DEPLOY_TOAST_ID,
} from '@/lib/stale-deploy';

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export interface OptimisticSaveOptions<V> {
  current: V;
  save: (next: V) => Promise<void>;
  onSuccess?: () => void;
  errorMessage?: string;
  /** Trailing debounce in ms. Defaults to 400. Set to 0 to disable
   *  (fires save synchronously on each update — original v1 behavior). */
  debounceMs?: number;
  /** The field's localStorage draft key (the same key passed to
   *  useLocalStorageDraft). When a save fails because the tab is older than
   *  the current deploy, the text is stashed under this key and re-saved
   *  automatically after the operator reloads. */
  stashKey?: string;
}

const DEFAULT_DEBOUNCE_MS = 400;

export function useOptimisticSave<V>({
  current,
  save,
  onSuccess,
  errorMessage,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  stashKey,
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
  const stashKeyRef = useRef(stashKey);
  useEffect(() => {
    saveRef.current = save;
    currentRef.current = current;
    onSuccessRef.current = onSuccess;
    errorMessageRef.current = errorMessage;
    stashKeyRef.current = stashKey;
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
          if (stashKeyRef.current) clearUnsaved(browserStorage(), stashKeyRef.current);
          onSuccessRef.current?.();
        } catch (e) {
          if (isStaleDeployError(e)) {
            // The tab predates the current deploy, so its Server Action IDs
            // are gone. The edit is fine: keep it in the field, stash it
            // for after the reload, and ask for a refresh instead of
            // reverting. One toast id so keystroke bursts don't stack.
            const value = latestValueRef.current;
            if (stashKeyRef.current && typeof value === 'string') {
              stashUnsaved(browserStorage(), stashKeyRef.current, value);
            }
            toast.error(STALE_DEPLOY_MESSAGE, {
              id: STALE_DEPLOY_TOAST_ID,
              duration: Infinity,
              action: { label: 'Refresh', onClick: () => window.location.reload() },
            });
            return;
          }
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

  // After a reload, re-save text that a stale tab couldn't save. The
  // field's useLocalStorageDraft already shows it (stashUnsaved also wrote
  // the draft key); this schedules the save through the normal path.
  useEffect(() => {
    if (!stashKey) return;
    const pending = readUnsaved(browserStorage(), stashKey);
    if (pending === null) return;
    update(pending as V);
  }, [stashKey, update]);

  // True from the first keystroke until the eventual save resolves.
  // Callers using "await isPending before regen" (per commit 5b0b14c)
  // remain correct: a debounced-but-not-yet-fired save still counts.
  const isPending = isDirty || isInFlight;

  return { value: local, update, isPending, savedAt };
}
