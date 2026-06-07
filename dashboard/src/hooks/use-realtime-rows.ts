// dashboard/src/hooks/use-realtime-rows.ts
//
// Subscribes to multiple Supabase rows filtered by a column=value match.
// Handles INSERT (appends), UPDATE (replaces by id), and DELETE (removes by id).
//
// Safety nets beyond postgres_changes, matching useRealtimeRow:
//   1. Initial SELECT on mount — catches the race where rows changed
//      BEFORE the subscription was established.
//   2. Conditional defensive refetch — only fires when realtime is NOT
//      healthy AND the tab is visible. Idle dashboards generate no traffic.
//   3. Visibility-change refetch — when tab regains focus, one immediate
//      refetch catches up on changes missed while hidden.
//
// Rationale: pg_stat_statements (2026-06-07) showed Realtime overhead as
// our #1 disk IO consumer; gating polls on websocket health cut idle-tab
// traffic to ~zero without losing the safety net.
//
// The T constraint requires an `id: string` field so INSERT/UPDATE/DELETE
// events can be reconciled against the local array without a full re-fetch.

'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const POLL_FALLBACK_MS = 30_000;

export function useRealtimeRows<T extends { id: string }>(
  table: string,
  filterColumn: string,
  filterValue: string | null,
  initial: T[],
): T[] {
  const [rows, setRows] = useState<T[]>(initial);
  const statusRef = useRef<string>('CLOSED');

  useEffect(() => {
    if (!filterValue) return;
    const supabase = createClient();
    let cancelled = false;

    async function refetch() {
      const { data } = await supabase.from(table).select('*').eq(filterColumn, filterValue);
      if (cancelled) return;
      if (data) setRows(data as T[]);
    }

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
            return prev.map((r) =>
              r.id === (payload.new as T).id ? (payload.new as T) : r,
            );
          });
        },
      )
      .subscribe((status) => {
        statusRef.current = status;
      });

    const pollId = setInterval(() => {
      if (statusRef.current === 'SUBSCRIBED') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refetch();
    }, POLL_FALLBACK_MS);

    function onVisible() {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [table, filterColumn, filterValue]);

  return rows;
}
