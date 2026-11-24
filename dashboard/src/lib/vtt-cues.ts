// dashboard/src/lib/vtt-cues.ts
//
// Client-safe parser for the captions VTT data URL that buildClipPayload
// produces (data:text/vtt;charset=utf-8;base64,...).
//
// Why: the Phase 4 player used to attach that data URL as a <track> child.
// On iOS, WebKit hands <track> sources to AVFoundation as out-of-band
// alternate tracks when it creates the asset, and the stitched video then
// failed to load at all (black player, crossed-out play icon) while the
// same mp4 played on the Live page, which has no <track>. Adding the cues
// with video.addTextTrack() after metadata loads keeps the CC option
// without giving AVFoundation a data: URL.

export interface VttCue {
  start: number;
  end: number;
  text: string;
}

function parseTime(t: string): number | null {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function decodeDataUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** Parse WEBVTT text into cues. Ignores headers, notes and malformed blocks. */
export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const [a, b] = lines[timingIdx].split('-->');
    const start = parseTime(a);
    const end = parseTime((b ?? '').trim().split(/\s+/)[0] ?? '');
    const text = lines.slice(timingIdx + 1).join('\n').trim();
    if (start == null || end == null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/** Parse a data:text/vtt URL (base64 or percent-encoded). Null/invalid → []. */
export function parseVttDataUrl(dataUrl: string | null | undefined): VttCue[] {
  if (!dataUrl) return [];
  const text = decodeDataUrl(dataUrl);
  return text ? parseVtt(text) : [];
}
