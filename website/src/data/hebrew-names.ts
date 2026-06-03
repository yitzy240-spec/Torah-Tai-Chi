// website/src/data/hebrew-names.ts
//
// Hebrew names keyed by parshiot.slug (DB shape). Keys MUST match the
// `slug` column in Supabase or HEBREW_NAMES[row.slug] silently renders
// empty.
//
// TODO (Phase 0.1 follow-up): populate `parshiot.hebrew_name` DB column
// and migrate parshiot.ts to read row.hebrew_name instead of looking up
// here. Until that lands, this file is the source of truth for Hebrew
// rendering on the public website.
//
// Slug shapes corrected 2026-06-03 — 10 previously-divergent keys
// (vayera→vayeira, behaalotecha→beha-alotcha, vaetchanan→va-etchanan,
// reeh→re-eh, haazinu→ha-azinu, vezot-habracha→v-zot-habracha, plus
// vayetzei→vayeitzei, vayeshev→vayeishev, miketz→mikeitz, vaera→va-eira)
// were silently rendering empty Hebrew names for those parshiot.
export const HEBREW_NAMES: Record<string, string> = {
  // Genesis / Bereishit
  bereishit: "בראשית",
  noach: "נח",
  "lech-lecha": "לך לך",
  vayeira: "וירא",
  "chayei-sarah": "חיי שרה",
  toldot: "תולדות",
  vayeitzei: "ויצא",
  vayishlach: "וישלח",
  vayeishev: "וישב",
  mikeitz: "מקץ",
  vayigash: "ויגש",
  vayechi: "ויחי",
  // Exodus / Shemot
  shemot: "שמות",
  "va-eira": "וארא",
  bo: "בא",
  beshalach: "בשלח",
  yitro: "יתרו",
  mishpatim: "משפטים",
  terumah: "תרומה",
  tetzaveh: "תצוה",
  "ki-tisa": "כי תשא",
  vayakhel: "ויקהל",
  pekudei: "פקודי",
  // Leviticus / Vayikra
  vayikra: "ויקרא",
  tzav: "צו",
  shemini: "שמיני",
  tazria: "תזריע",
  metzora: "מצרע",
  "acharei-mot": "אחרי מות",
  kedoshim: "קדושים",
  emor: "אמור",
  behar: "בהר",
  bechukotai: "בחקתי",
  // Numbers / Bamidbar
  bamidbar: "במדבר",
  naso: "נשא",
  "beha-alotcha": "בהעלתך",
  shelach: "שלח",
  korach: "קרח",
  chukat: "חקת",
  balak: "בלק",
  pinchas: "פינחס",
  matot: "מטות",
  masei: "מסעי",
  // Deuteronomy / Devarim
  devarim: "דברים",
  "va-etchanan": "ואתחנן",
  eikev: "עקב",
  "re-eh": "ראה",
  shoftim: "שופטים",
  "ki-teitzei": "כי תצא",
  "ki-tavo": "כי תבוא",
  nitzavim: "נצבים",
  vayeilech: "וילך",
  "ha-azinu": "האזינו",
  "v-zot-habracha": "וזאת הברכה",
};
