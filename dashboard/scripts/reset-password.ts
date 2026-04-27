// Reset an existing Supabase auth user's password via the admin API.
//
// Usage (from the `dashboard/` directory):
//   npx tsx --env-file=.env.local scripts/reset-password.ts <email> <password>
//
// Example:
//   npx tsx --env-file=.env.local scripts/reset-password.ts info@torahtaichi.com TorahTC1
//
// Use this when a user was added via the settings UI before the password
// field existed, or when someone forgot their password and email reset
// isn't an option.
import { createClient } from '@supabase/supabase-js';

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('Usage: tsx scripts/reset-password.ts <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: npx tsx --env-file=.env.local scripts/reset-password.ts ...');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const target = email.toLowerCase();
  const { data, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error(`Could not list users: ${listErr.message}`);
    process.exit(1);
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === target);
  if (!user) {
    console.error(`No user found with email ${target}.`);
    process.exit(1);
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (error) {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`Password updated for ${target} (${user.id}).`);
}
main();
