// dashboard/src/lib/word-count.ts
//
// Live word/duration/wps feedback for the script editor (Phase 1) and
// the clip plan voiceover fields (Phase 2 + 3). All thresholds match
// the pipeline's behavior: 2.6 wps target, 3.0 wps warning ceiling.

export const TARGET_WPS = 2.6;
export const WARN_WPS = 3.0;

export interface ScriptFeedback {
  words: number;
  estimatedSeconds: number;
  wps: number; // assumes the script will be spoken at TARGET_WPS
  fits60s: boolean;
  warning: 'tight' | null;
}

export function analyzeScript(text: string | null | undefined): ScriptFeedback {
  const words = countWords(text);
  const estimatedSeconds = words / TARGET_WPS;
  return {
    words,
    estimatedSeconds,
    wps: TARGET_WPS,
    fits60s: estimatedSeconds <= 60,
    warning: null,
  };
}

export interface ClipFeedback {
  words: number;
  durationS: number;
  wps: number;
  warning: 'tight' | null;
}

export function analyzeClip(text: string | null | undefined, durationS: number): ClipFeedback {
  const words = countWords(text);
  const wps = durationS > 0 ? words / durationS : 0;
  return {
    words,
    durationS,
    wps,
    warning: wps > WARN_WPS ? 'tight' : null,
  };
}

function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
