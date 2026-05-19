// dashboard/src/lib/ref-image-library.ts
//
// Static reference image library for the Phase 2 reference image picker.
//
// Reference images live in Supabase Storage under the "videos" bucket.
// The Modal pipeline uploads them at job time via _upload_dir / _upload_jewish_refs.
// The Storage paths mirror the file layout in /root/references/ on Modal:
//
//   Character:   refs/char/<filename>      (root of references/ dir)
//   Dojo:        refs/dojo/<filename>      (references/dojo/ dir)
//   Jewish:      refs/jewish/<filename>    (references/jewish/ dir)
//
// These are the same paths that Modal resolves when it uploads refs at the
// start of each pipeline run. The dashboard reads them back for the picker.
//
// NOTE: This is a static list mirroring the known on-disk assets. If new
// references are added to /root/references/ on Modal, add an entry here too.

import { publicVideoUrl } from '@/lib/storage-url';
import type { RefImage, RefImageCategory } from '@/app/videos/[slug]/_components/_shared/reference-image-picker-sheet';

interface RawRef {
  path: string;
  label: string;
  category: RefImageCategory;
}

const RAW_REFS: RawRef[] = [
  // Character refs
  { path: 'refs/char/01_front_neutral.png',            label: 'Rav Eli — front neutral',         category: 'character' },
  { path: 'refs/char/03_threequarter_right_speaking.png', label: 'Rav Eli — ¾ right speaking',    category: 'character' },
  { path: 'refs/char/04_threequarter_left_speaking.png',  label: 'Rav Eli — ¾ left speaking',     category: 'character' },
  { path: 'refs/char/05_profile_right.png',            label: 'Rav Eli — profile right',         category: 'character' },
  { path: 'refs/char/06_fullbody_ready_stance.png',    label: 'Rav Eli — full body ready',       category: 'character' },
  { path: 'refs/char/07_fullbody_yinyang_pose.png',    label: 'Rav Eli — yin-yang pose',         category: 'character' },
  { path: 'refs/char/08_fullbody_flowing_pose.png',    label: 'Rav Eli — flowing pose',          category: 'character' },
  { path: 'refs/char/09_seated_teaching.png',          label: 'Rav Eli — seated teaching',       category: 'character' },
  { path: 'refs/char/10_closeup_thoughtful.png',       label: 'Rav Eli — close-up thoughtful',   category: 'character' },
  { path: 'refs/char/11_walking_forward.png',          label: 'Rav Eli — walking forward',       category: 'character' },
  { path: 'refs/char/12_meditation_pose.png',          label: 'Rav Eli — meditation pose',       category: 'character' },
  { path: 'refs/char/13_overshoulder_back.png',        label: 'Rav Eli — over-shoulder',         category: 'character' },

  // Dojo refs
  { path: 'refs/dojo/dojo_three_quarter_yinyang.png', label: 'Dojo — ¾ yin-yang',               category: 'dojo' },
  { path: 'refs/dojo/dojo_wide_morning.png',           label: 'Dojo — wide morning',              category: 'dojo' },

  // Jewish ritual refs
  { path: 'refs/jewish/shabbat_candles.jpg',   label: 'Shabbat candles',    category: 'jewish' },
  { path: 'refs/jewish/shabbat_table.jpg',     label: 'Shabbat table',      category: 'jewish' },
  { path: 'refs/jewish/challah.jpeg',          label: 'Challah (uncovered)',category: 'jewish' },
  { path: 'refs/jewish/challah_covered.jpg',   label: 'Challah (covered)',  category: 'jewish' },
  { path: 'refs/jewish/kiddush_cup.jpg',       label: 'Kiddush cup',        category: 'jewish' },
  { path: 'refs/jewish/tefillin_worn.jpg',     label: 'Tefillin',           category: 'jewish' },
  { path: 'refs/jewish/tallit_worn.jpg',       label: 'Tallit',             category: 'jewish' },
  { path: 'refs/jewish/lulav_etrog.jpg',       label: 'Lulav & etrog',      category: 'jewish' },
  { path: 'refs/jewish/sukkah_interior.jpg',   label: 'Sukkah interior',    category: 'jewish' },
];

/**
 * Returns the full reference image library with resolved public thumb URLs.
 *
 * Thumbnails are resolved as Supabase Storage public URLs (same "videos"
 * bucket that Modal uploads refs into). If an image hasn't been uploaded yet
 * the URL will 404 — the picker renders a text placeholder in that case.
 */
export function getRefImageLibrary(): RefImage[] {
  return RAW_REFS.map((r) => ({
    path: r.path,
    label: r.label,
    category: r.category,
    thumbUrl: publicVideoUrl(r.path),
  }));
}
