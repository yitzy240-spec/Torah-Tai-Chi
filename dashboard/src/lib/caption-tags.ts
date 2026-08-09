// dashboard/src/lib/caption-tags.ts
//
// Split a flat caption into body + trailing hashtag block and re-join
// them. The flat string is canonical; the split is a UI convenience for
// the posting cards' separate Body / Hashtags fields.
//
// The tag pattern MUST accept apostrophes: plan captions use tags like
// #Va'etchanan and #Re'eh. The old pattern (#[\w_]+) stopped at the
// apostrophe, so editing such a caption left half the hashtag block
// inside the body and re-appended a full block after it — the Re'eh FB
// post went out with its hashtags duplicated plus a stranded "#"
// (2026-08-04). joinCaption also strips any hashtag remnant still stuck
// to the body so legacy-mangled captions self-heal on the next save.

const TRAILING_TAG_BLOCK = /^([\s\S]*?)(?:\n+)?((?:#[\w'’_]+\s*)+)$/;

export function splitCaption(s: string): { body: string; tags: string } {
  const m = s.match(TRAILING_TAG_BLOCK);
  if (!m) return { body: s, tags: '' };
  return { body: m[1].trim(), tags: m[2].trim() };
}

export function joinCaption(body: string, tags: string): string {
  // Strip any trailing hashtag remnant left on the body by older splits:
  // first the stranded bare "#" (it blocks the tag-run match), then the
  // orphaned tag run itself.
  let b = body.trim().replace(/[\s#]+$/, '');
  b = splitCaption(b).body;
  return tags ? `${b}\n\n${tags}` : b;
}
