/**
 * Image normalization for Buffer posts. Buffer forwards our image URL to
 * each network, and each network has its own limits:
 *   - TikTok:    max 2,073,600 pixels (1920×1080)
 *   - Twitter:   max 5 MB
 *   - Instagram: works with reasonable sizes; also needs post-type metadata
 *
 * We run every image through this helper before passing it to Buffer so
 * there's one well-sized asset that every network will accept.
 */

import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/service';
import { createHash } from 'crypto';

const BUCKET = 'videos';
const NORMALIZED_PREFIX = 'compose/normalized';
const SUPABASE_PUBLIC = (key: string) =>
  `https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/${BUCKET}/${key}`;

// Stay safely under TikTok's 2.07M cap: 1440×1440 = 2.07M exactly, so cap at 1400.
const MAX_LONG_EDGE = 1400;
const JPEG_QUALITY = 88;
const LINEN_BG = { r: 250, g: 244, b: 232, alpha: 1 } as const;

/**
 * Download the image at `sourceUrl`, resize + flatten onto a linen background
 * (handles transparent PNG logos), re-encode as JPEG, upload to Supabase under
 * a deterministic key (sha1 of sourceUrl — idempotent on repeat calls), and
 * return the public URL of the normalized asset.
 */
export async function normalizeForSocials(sourceUrl: string): Promise<string> {
  const hash = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16);
  const key = `${NORMALIZED_PREFIX}/${hash}.jpg`;
  const publicUrl = SUPABASE_PUBLIC(key);

  // Skip if we've already normalized this source.
  const head = await fetch(publicUrl, { method: 'HEAD' }).catch(() => null);
  if (head?.ok) return publicUrl;

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Fetch source image: ${res.status}`);
  const src = Buffer.from(await res.arrayBuffer());

  const normalized = await sharp(src)
    .rotate() // auto-orient EXIF
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: LINEN_BG })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const svc = createServiceClient();
  const { error: upErr } = await svc.storage.from(BUCKET).upload(key, normalized, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: true,
  });
  if (upErr) throw new Error(`Supabase upload (normalized): ${upErr.message}`);

  return publicUrl;
}
