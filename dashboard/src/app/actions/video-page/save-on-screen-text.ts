'use server';
import { createClient } from '@/lib/supabase/server';
import { onScreenStitchPayload, type OnScreenTextFields } from '@/lib/on-screen-text';

type StitchSettings = {
  cuts?: Record<string, 'hard' | 'fade'>;
  on_screen?: {
    hook_text: string;
    caption_override: string;
    enabled: boolean;
  };
  [key: string]: unknown;
};

/**
 * Persist hook text, optional caption override, and the burn toggle on the
 * videos row. Also mirrors them into stitch_settings.on_screen so Modal
 * compose can still read the settings if a SELECT omits the new columns.
 * Does not re-stitch; the operator then applies via restitchVideo.
 */
export async function saveOnScreenText(opts: {
  videoId: string;
  fields: OnScreenTextFields;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const hookText = opts.fields.hookText.trim();
  const captionOverride = opts.fields.captionOverride.trim();
  const enabled = opts.fields.enabled;

  const { data: video, error: readErr } = await supabase
    .from('videos')
    .select('id, stitch_settings')
    .eq('id', opts.videoId)
    .single();
  if (readErr || !video) {
    return { error: readErr?.message ?? 'Video not found.' };
  }
  const existing = (video.stitch_settings ?? {}) as StitchSettings;
  const stitch_settings: StitchSettings = {
    ...existing,
    on_screen: onScreenStitchPayload({ hookText, captionOverride, enabled }),
  };

  const withColumns = {
    hook_text: hookText || null,
    caption_override: captionOverride || null,
    burn_on_screen_text: enabled,
    stitch_settings,
  };
  const { error } = await supabase
    .from('videos')
    .update(withColumns)
    .eq('id', opts.videoId);
  if (error) {
    // Pre-migration: the new columns are not on prod yet. Persist through
    // stitch_settings.on_screen so the form still works; Modal reads that
    // fallback until the migration is applied.
    const missingCol = /hook_text|caption_override|burn_on_screen_text|schema cache/i.test(
      error.message ?? '',
    );
    if (!missingCol) return { error: `Could not save on-screen text: ${error.message}` };
    const retry = await supabase
      .from('videos')
      .update({ stitch_settings })
      .eq('id', opts.videoId);
    if (retry.error) {
      return { error: `Could not save on-screen text: ${retry.error.message}` };
    }
  }
  return { ok: true };
}
