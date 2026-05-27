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
  // Track the key we last hydrated from. When the caller switches
  // keys (e.g., Phase 1 'Try another' picks a different script_id),
  // we re-read localStorage for the new key. A boolean one-shot flag
  // would lock us to the first key forever — that's the bug Yonah hit:
  // picking an alternate left the textarea showing the original script.
  const loadedForKey = useRef<string | null>(null);

  useEffect(() => {
    if (loadedForKey.current === key) return;
    loadedForKey.current = key;
    try {
      const stored = window.localStorage.getItem(key);
      // Adopt stored draft if present; otherwise fall back to the server
      // value for the new key. Without the explicit fallback, state
      // would stay pinned to the previous key's value.
      setValue(stored !== null ? (stored as T) : initialServerValue);
    } catch {
      // localStorage may be unavailable (private browsing, etc.).
      setValue(initialServerValue);
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
