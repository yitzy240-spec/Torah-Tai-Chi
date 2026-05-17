// dashboard/src/hooks/use-realtime-rows.ts
//
// Subscribes to multiple Supabase rows filtered by a column=value match.
// Handles INSERT (appends), UPDATE (replaces by id), and DELETE (removes by id).
// Cleanup removes the channel on unmount or when filter values change.
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
    const channel = supabase
      .channel(`rows:${table}:${filterColumn}:${filterValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${filterValue}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new as T];
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filterColumn, filterValue]);

  return rows;
}
