import { createClient } from '@/lib/supabase/server';
import { CostTotals } from './cost-totals';
import { SignOutButton } from './sign-out-button';

export async function Header() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <header className="flex items-center justify-between border-b bg-white px-4 py-3 sm:px-6">
      <div className="text-sm font-medium">Torah Tai Chi</div>
      <div className="flex items-center gap-4">
        <CostTotals />
        <span className="hidden text-sm text-neutral-600 sm:inline">
          {user.user_metadata?.name ?? user.email}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
