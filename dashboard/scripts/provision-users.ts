// Run once: npx tsx dashboard/scripts/provision-users.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const users = [
  { email: 'yonah@torahtaichi.com', name: 'Yonah' },
  { email: 'harvey@torahtaichi.com', name: 'Harvey' },
  { email: 'yitzy@torahtaichi.com', name: 'Yitzy' },
];

async function main() {
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      user_metadata: { name: u.name },
    });
    if (error) { console.warn(`${u.email}: ${error.message}`); continue; }
    console.log(`created ${u.email} (${data.user?.id})`);
  }
}
main();
