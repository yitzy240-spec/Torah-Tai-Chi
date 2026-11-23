/**
 * On-screen hook + spoken captions burned in at stitch time.
 *
 * The toggle defaults ON only when Yonah has set a hook line or a
 * caption override. Spoken voiceover alone does not auto-enable, because
 * voiceovers may contain pronunciation spellings ("Sha-BAHT") that must
 * not appear on screen unless he opts in (Matot preview, 2026-07-07).
 */
export function defaultBurnOnScreenText(hookText: string, captionOverride: string): boolean {
  return Boolean(hookText.trim() || captionOverride.trim());
}

export type OnScreenTextFields = {
  hookText: string;
  captionOverride: string;
  enabled: boolean;
};

/** Payload stored under videos.stitch_settings.on_screen (and mirrored to columns). */
export function onScreenStitchPayload(fields: OnScreenTextFields): {
  hook_text: string;
  caption_override: string;
  enabled: boolean;
} {
  return {
    hook_text: fields.hookText,
    caption_override: fields.captionOverride,
    enabled: fields.enabled,
  };
}
