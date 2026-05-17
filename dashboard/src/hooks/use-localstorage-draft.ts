// dashboard/src/hooks/use-localstorage-draft.ts
//
// Generalized localStorage draft persistence. Pass a stable key
// (e.g. `caption.${platform}.${videoId}` or `script.${parshaSlug}`)
// and the current server-side value. The hook returns [current,
// setLocal, clearDraft] and reconciles with the server value on mount:
// if a local draft exists and differs from the server value, the local
// draft wins (the user's unsaved work is more recent than the last
// successful save).
//
// This generalizes the captions-list localStorage behavior (commit
// d16a44e per kickoff doc) so every editable field gets the same
// "draft survives refresh / tab switch / machine swap" property.
//
// Auto-clear is NOT done here — clearing is the caller's responsibility
// (useOptimisticSave calls clearDraft on success). This keeps the hook
// single-purpose and avoids clearing a draft that the server hasn't
// actually persisted yet.

'use client';
import { useEffect, useRef, useState } from 'react';

export function useLocalStorageDraft<T extends string>(
  key: string,
  initialServerValue: T,
): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(initialServerValue);
  const loaded = useRef(false);

  // On mount: read localStorage. If a draft exists, use it.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null && stored !== initialServerValue) {
        setValue(stored as T);
      }
    } catch {
      // localStorage may be unavailable (private browsing, etc.) — fall back to server value.
    }
  }, [key, initialServerValue]);

  function setLocal(next: T) {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Ignore write failures (storage quota, private mode).
    }
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }

  return [value, setLocal, clearDraft];
}
