// Run: npx tsx dashboard/scripts/seed-missing-scripts.ts
//
// Fills in draft scripts for parshiot that have none, from parshiot.json.
//
// WHY THIS EXISTS AND WHY IT IS NOT seed-parshiot.ts
// --------------------------------------------------
// seed-parshiot.ts upserts the PARSHIOT ROW as well as the scripts, and it
// writes book as the long form from parshiot.json ("Devarim (Deuteronomy)").
// Live rows carry the short form ("Devarim"), and the dashboard parsha picker
// groups by exact string against ['Bereishit','Shemot',...,'Devarim'] — so a
// full re-seed would silently drop every parsha out of the picker's sections.
// This script therefore NEVER touches the parshiot table. It only writes
// scripts, and only for parshiot that are already there.
//
// It is safe to re-run, and safe to run against a half-seeded parsha:
//   - each OPTION is judged on its own (scriptsToSeed). An option holding
//     real text is left alone; every other option is still written. The
//     earlier per-parsha version skipped a whole parsha the moment one
//     option had text — including text the same run had just written — and
//     so left parshiot stuck with option A and nothing else.
//   - a placeholder row (draft_text '', created by startFromEmpty when the
//     operator hits "Start scripting") counts as empty and is filled in
//     place, because the upsert key is (parsha_id, option)
//   - an operator's hand-written draft is never overwritten
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scriptsToSeed } from '../src/lib/seed-scripts.ts';
import type { ExistingScript } from '../src/lib/seed-scripts.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}
const supabase = createClient(url, key);

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../parshiot.json'), 'utf8'),
) as {
  parshiot: Array<{
    order: number;
    name: string;
    book: string;
    scripts: Array<{ option: string; title: string; style_note: string; draft: string }>;
  }>;
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  let filled = 0;
  let skipped = 0;
  const absent: string[] = [];

  for (const p of data.parshiot) {
    const slug = slugify(p.name);

    const { data: parsha, error: lookupErr } = await supabase
      .from('parshiot')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!parsha) {
      // No row to attach to. Deliberately NOT created here — see header.
      absent.push(`${p.name} (${slug})`);
      continue;
    }

    const { data: existing, error: scriptsErr } = await supabase
      .from('scripts')
      .select('option, draft_text')
      .eq('parsha_id', parsha.id as string);
    if (scriptsErr) throw scriptsErr;

    // Per-option, never per-parsha — see seed-scripts.ts for why that
    // distinction is the difference between finishing the job and stopping
    // after option A.
    const toWrite = scriptsToSeed(
      (existing ?? []) as ExistingScript[],
      p.scripts.map((s) => ({
        option: s.option,
        title: s.title,
        style_note: s.style_note,
        draft: s.draft,
      })),
    );
    if (toWrite.length === 0) {
      skipped++;
      continue;
    }

    for (const s of toWrite) {
      const { error } = await supabase.from('scripts').upsert(
        {
          parsha_id: parsha.id as string,
          option: s.option,
          title: s.title,
          style_note: s.style_note,
          draft_text: s.draft,
        },
        { onConflict: 'parsha_id,option' },
      );
      if (error) throw error;
    }
    filled++;
    const opts = toWrite.map((s) => s.option).join(', ');
    console.log(`filled ${p.name} — ${toWrite.length} scripts (${opts})`);
  }

  console.log(`\ndone: ${filled} filled, ${skipped} already written`);
  if (absent.length > 0) {
    console.log(`no parsha row found for: ${absent.join(', ')}`);
  }
}

main();
