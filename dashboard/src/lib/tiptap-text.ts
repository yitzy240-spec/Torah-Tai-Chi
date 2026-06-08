/**
 * Flatten a TipTap/ProseMirror doc to plain text for AI prompts.
 * Text nodes are concatenated; block-level nodes are separated by newlines.
 * Resilient to null/odd input.
 */
const BLOCK = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'tableHeader', 'tableCell']);

export function tiptapJsonToText(doc: unknown): string {
  const out: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') { out.push(n.text); return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && BLOCK.has(n.type)) out.push('\n');
  }
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}
