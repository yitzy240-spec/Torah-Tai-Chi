// dashboard/src/hooks/use-realtime-rows.ts
//
// Subscribes to multiple Supabase rows filtered by a column=value match.
// Handles INSERT (appends), UPDATE (replaces by id), and DELETE (removes by id).
//
// Two safety nets beyond postgres_changes, matching useRealtimeRow:
//   1. Initial SELECT on mount — catches the race where rows changed
//      BEFORE the subscription was established (server rendered the
//      initial set as no-storage_path, Modal finished a clip during
//      hydration, no event arrives because the change already happened).
//   2. Periodic refetch every 10s — catches dropped websockets, RLS
//      shape drift, network blips, anything else that silently kills
//      postgres_changes delivery. Cheap (one filtered SELECT, small
//      result set) and bounds worst-case wait at 10s.
//
// The T constraint requires an `id: string` field so INSERT/UPDATE/DELETE
// events can be reconciled against the local array without a full re-fetch.

'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeRows<T extends { id: string }>(
  table: string,
  filterColumn: string,
  filterValue: string | null,
  initial: T[],
): T[] {
  const [rows, setRows] = useState<T[]>(initial);

  useEffect(() => {
    if (!filterValue) return;
    const supabase = createClient();
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase.from(table).select('*').eq(filterColumn, filterValue);
      if (cancelled) return;
      if (data) setRows(data as T[]);
    }

    // Fetch current state immediately so we don't trust a stale `initial`
    // prop or miss row changes that happened between server render and
    // client subscribe.
    void refetch();

    const channel = supabase
      .channel(`rows:${table}:${filterColumn}:${filterValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${filterValue}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') {
              const incoming = payload.new as T;
              // Idempotent — if a refetch raced us, don't duplicate.
              if (prev.some((r) => r.id === incoming.id)) return prev;
              return [...prev, incoming];
            }
            if (payload.eventType === 'DELETE')
              return prev.filter((r) => r.id !== (payload.old as T).id);
            // UPDATE
            return prev.map((r) =>
              r.id === (payload.new as T).id ? (payload.new as T) : r,
            );
          });
        },
      )
      .subscribe();

    // Defensive poll: if Realtime drops, we still advance.
    const pollId = setInterval(refetch, 10_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [table, filterColumn, filterValue]);

  return rows;
}
