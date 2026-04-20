import { createServiceClient } from '@/lib/supabase/service';

export type Stance = 'handson' | 'reviewer' | 'batch' | 'auto';
const ALLOWED: Stance[] = ['handson', 'reviewer', 'batch', 'auto'];
const KEY = 'settings.stance';
const DEFAULT: Stance = 'reviewer';

/** Read the persisted stance from site_content. Defaults to 'reviewer'. */
export async function getStance(): Promise<Stance> {
  const sb = createServiceClient();
  const { data } = await sb.from('site_content').select('value').eq('key', KEY).maybeSingle();
  const raw = data?.value;
  if (typeof raw === 'string' && (ALLOWED as string[]).includes(raw)) return raw as Stance;
  return DEFAULT;
}

/** Upsert a new stance into site_content. */
export async function setStance(stance: Stance): Promise<void> {
  if (!ALLOWED.includes(stance)) throw new Error(`Invalid stance: ${stance}`);
  const sb = createServiceClient();
  const { error } = await sb
    .from('site_content')
    .upsert({ key: KEY, value: stance }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}
