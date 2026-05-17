// dashboard/src/lib/feature-flag.ts
//
// Tiny feature-flag reader. Flags live in the site_content table as
// rows with key='settings.<flag_name>' and a JSON value. For the
// video-page redesign rollout, the flag is 'settings.video_page_v2'
// with value true/false. Add new flags by writing a new row — no schema
// change needed.
//
// Returns a boolean. Falsy (false) is the safe default: if the row is
// missing or the value is anything other than true/'true', the flag is
// treated as off. This makes the legacy page the safe default until the
// operator explicitly seeds the flag.

import { createClient } from '@/lib/supabase/server';

export async function getFlag(name: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', `settings.${name}`)
    .maybeSingle();
  return data?.value === true || data?.value === 'true';
}
