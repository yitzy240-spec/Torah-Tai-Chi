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
  // 3a. Loop: collapse empty inline wrappers (e.g. <span></span>, <b></b>) until stable.
  //     Needed so <p><span></span></p> reduces to <p></p> which step 4 then removes.
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<(span|b|i|u|em|strong|font|sub|sup)>\s*<\/\1>/gi, '');
  } while (out !== prev);
  // 3b. Unwrap bare <span> tags (no attributes remain after step 3).
  //     Word uses spans purely for formatting noise; unwrapping them prevents
  //     run-together words when the structural-whitespace step collapses newlines.
  out = out.replace(/<span>([\s\S]*?)<\/span>/gi, '$1');
  // 4. Collapse whitespace-only / &nbsp;-only paragraphs.
  out = out.replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/gi, '');
  // 5. Collapse STRUCTURAL whitespace (Word's newlines/tabs between block tags) to a
  //    single space. A run containing any newline or tab is structural indentation, not
  //    real content. Collapsing to space (not empty) avoids run-together words when
  //    inline spans were on separate lines.
  out = out.replace(/>[ \t\r\n]*[\r\n\t][ \t\r\n]*</g, '> <');
  // 5b. Collapse any remaining whitespace run that contains a newline/carriage-return
  //     (e.g. Word line-wrapping within text after spans were unwrapped) to a single
  //     space. Plain single spaces (real word spaces) contain no newlines, so they are
  //     not affected.
  out = out.replace(/[ \t]*[\r\n][ \t\r\n]*/g, ' ');
  // 6. Strip a leading bullet glyph and/or leading whitespace/tab at the start of a
  //    block element's text. Handles Word list paragraphs pasted as "•\tItem text".
  out = out.replace(/(<(?:p|li|h2|h3|blockquote)>)[ \t ]*[•·▪\-\*]?[ \t ]*/gi, '$1');
  return out.trim();
}
