import { createClient } from '@/lib/supabase/server';
import { ParshaPicker } from '@/components/parsha-picker';

export default async function InboxPage() {
  const supabase = await createClient();
  const { data: parshiot, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, scripts(id, option, title)')
    .order('order');

  if (error) {
    return <pre className="p-6 text-red-600">{error.message}</pre>;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-semibold">Inbox</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Pick a parsha to generate this week&apos;s video.
      </p>
      <ParshaPicker parshiot={parshiot ?? []} />
    </div>
  );
}
