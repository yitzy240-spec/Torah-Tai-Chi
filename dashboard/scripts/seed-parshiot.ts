// Run once: npx tsx dashboard/scripts/seed-parshiot.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../parshiot.json'), 'utf8'),
) as { parshiot: Array<{
  order: number; name: string; book: string;
  scripts: Array<{ option: string; title: string; style_note: string; draft: string }>;
}> };

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  for (const p of data.parshiot) {
    const slug = slugify(p.name);
    const { data: parsha, error } = await supabase
      .from('parshiot')
      .upsert({ order: p.order, name: p.name, book: p.book, slug }, { onConflict: 'slug' })
      .select('id').single();
    if (error) throw error;

    for (const s of p.scripts) {
      await supabase.from('scripts').upsert({
        parsha_id: parsha!.id,
        option: s.option,
        title: s.title,
        style_note: s.style_note,
        draft_text: s.draft,
      }, { onConflict: 'parsha_id,option' });
    }
    console.log(`seeded ${p.name} (${p.scripts.length} scripts)`);
  }
}
main();
