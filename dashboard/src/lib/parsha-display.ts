// dashboard/src/lib/parsha-display.ts
//
// Double-parsha display for the dashboard (e.g. "Matot-Masei"). Mirrors the
// website's logic (website/src/lib/parsha-display.ts) so both apps read the
// same. Seven weeks a year two parshiot are read together; leap years split
// them. Combined videos live at the LEAD slug (Hebcal maps "Matot-Masei" →
// matot and the pipeline keys the video off that parsha).

/** Lead slug → partner slug for the 7 canonical double-parsha pairs. */
export const DOUBLE_PARSHA_PARTNER: Record<string, string> = {
  vayakhel: 'pekudei',
  tazria: 'metzora',
  'acharei-mot': 'kedoshim',
  behar: 'bechukotai',
  chukat: 'balak',
  matot: 'masei',
  nitzavim: 'vayeilech',
};

/** Join a lead + partner English name into the combined display form. */
export function joinParshaNames(lead: string, partner: string): string {
  return `${lead}-${partner}`;
}
