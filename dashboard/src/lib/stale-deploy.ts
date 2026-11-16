// dashboard/src/lib/stale-deploy.ts
//
// A tab opened before a deploy calls Server Actions by IDs the new build no
// longer has. Next throws "Failed to find Server Action "…". This request
// might be from an older or newer deployment." (the client surfaces it as
// "Server Action '…' was not found on the server"). The edit itself is fine,
// so reverting it throws away the operator's work (Yonah, 2026-11-16, a
// TikTok caption right after the PR #33 deploy). Instead: keep the text,
// stash it per field, ask for a refresh, and re-save it after the reload.
//
// Kept pure (Storage is passed in) so it runs under node:test.

export const STALE_DEPLOY_MESSAGE =
  'The dashboard was updated. Refresh the page to save your change (your text is kept).';

/** Stable toast id so a burst of failing keystroke-saves shows one toast. */
export const STALE_DEPLOY_TOAST_ID = 'stale-deploy';

const PATTERNS = [
  /failed to find server action/i,
  /server action .* was not found on the server/i,
  /older or newer deployment/i,
];

/** True when an error (or message) is Next's stale-deploy Server Action error. */
export function isStaleDeployError(err: unknown): boolean {
  let message = '';
  if (typeof err === 'string') message = err;
  else if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    message = typeof m === 'string' ? m : '';
  }
  return message !== '' && PATTERNS.some((re) => re.test(message));
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage key for a field's unsaved-after-stale-deploy text. */
export function unsavedKey(fieldKey: string): string {
  return `unsaved.${fieldKey}`;
}

/** Remember text that couldn't be saved because the tab was stale. Also
 *  writes the field's own draft key (fieldKey), which the field's
 *  useLocalStorageDraft reads on mount, so the text reappears after reload. */
export function stashUnsaved(storage: StorageLike | null | undefined, fieldKey: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(fieldKey, value);
    storage.setItem(unsavedKey(fieldKey), value);
  } catch {
    // Quota / private mode — the text still stays in the field in memory.
  }
}

/** Read the stashed text for a field, or null when there's none. */
export function readUnsaved(storage: StorageLike | null | undefined, fieldKey: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(unsavedKey(fieldKey));
  } catch {
    return null;
  }
}

/** Drop the stash marker (after a successful save). */
export function clearUnsaved(storage: StorageLike | null | undefined, fieldKey: string): void {
  if (!storage) return;
  try {
    storage.removeItem(unsavedKey(fieldKey));
  } catch {
    // Ignore.
  }
}
