/**
 * Strip Microsoft Word / Office paste cruft from an HTML string while keeping
 * structural tags (p, h2, h3, ul, ol, li, table, tr, td, th, a, strong, em, br).
 * Pure string transform — runs in Node (tests) and the browser (paste hook).
 * TipTap's own schema parsing then maps the cleaned HTML into supported nodes.
 */
export function cleanWordHtml(html: string): string {
  let out = html;
  // 1. Remove MS conditional comments and any HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // 2. Remove Office-namespaced tags (o:p, w:..., m:..., v:...), keep inner content.
  out = out.replace(/<\/?(?:o|w|m|v|st1|x):[^>]*>/gi, '');
  // 3. Strip noise attributes from all tags (style, class, lang, mso-*, dir, align, etc.).
  out = out.replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (_m, tag) => `<${tag.toLowerCase()}>`);
  // 4. Collapse whitespace-only / &nbsp;-only paragraphs.
  out = out.replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/gi, '');
  // 5. Trim runs of whitespace between tags.
  out = out.replace(/>\s+</g, '><').trim();
  return out;
}
