/** Make an upload filename safe + tidy. Keeps a single trailing extension. */
export function sanitizeAssetFilename(name: string): string {
  const trimmed = (name ?? '').trim();
  const dot = trimmed.lastIndexOf('.');
  const hasExt = dot > 0 && dot < trimmed.length - 1;
  const ext = hasExt ? trimmed.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (hasExt ? trimmed.slice(0, dot) : trimmed)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeBase = base || 'image';
  return ext ? `${safeBase}.${ext}` : safeBase;
}
