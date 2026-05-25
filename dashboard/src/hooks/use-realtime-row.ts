// dashboard/src/hooks/use-realtime-row.ts
//
// Subscribes to a single Supabase row by its id. Returns the latest
// snapshot of the row, updating in real-time as the row changes.
// Handles INSERT, UPDATE, and DELETE events from postgres_changes.
//
// Two safety nets beyond the postgres_changes subscription:
//   1. Initial SELECT on mount — catches the race where the row changed
//      BEFORE the subscription was established (server rendered with
//      status='queued', Modal completed the job during hydration, no
//      UPDATE event arrives because the change already happened).
//   2. Periodic refetch every 10s — catches dropped websockets, RLS
//      shape drift, and any other case where postgres_changes silently
//      stops delivering. Cheap because Supabase serves it from the
//      replica with sub-100ms latency.

'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeRow<T>(table: string, id: string | null, initial: T | null): T | null {
  const [row, setRow] = useState<T | null>(initial);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (data) setRow(data as T);
      else setRow(null);
    }

    // Fetch current state immediately so we don't trust a stale `initial`
    // prop or miss a row change that happened between server render and
    // client subscribe.
    void refetch();

    const channel = supabase
      .channel(`row:${table}:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRow(null);
          } else {
            setRow(payload.new as T);
          }
        },
      )
      .subscribe();

    // Defensive poll: if Realtime drops (websocket close, RLS shape
    // change, network blip) we keep advancing instead of spinning.
    const pollId = setInterval(refetch, 10_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [table, id]);

  return row;
}
