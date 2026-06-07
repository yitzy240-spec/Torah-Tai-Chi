// dashboard/src/hooks/use-realtime-row.ts
//
// Subscribes to a single Supabase row by its id. Returns the latest
// snapshot of the row, updating in real-time as the row changes.
// Handles INSERT, UPDATE, and DELETE events from postgres_changes.
//
// Safety nets beyond the postgres_changes subscription:
//   1. Initial SELECT on mount — catches the race where the row changed
//      BEFORE the subscription was established.
//   2. Conditional defensive refetch — only fires when realtime is NOT
//      healthy (CHANNEL_ERROR / TIMED_OUT / CLOSED) AND the tab is
//      visible. Healthy realtime + visible tab = zero idle queries.
//   3. Visibility-change refetch — when the tab regains focus, one
//      immediate refetch catches up on anything missed while hidden.
//
// Why conditional vs. flat 10s poll (the previous design): pg_stat_statements
// showed Realtime WAL-decode queries as our #1 disk IO consumer. The
// flat poll forced ~6 fallback SELECTs/min/hook even when realtime was
// delivering perfectly — wasted IO budget every time a dashboard tab
// was open. The conditional poll preserves the safety net for genuine
// websocket failures without the idle cost.

'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const POLL_FALLBACK_MS = 30_000;

export function useRealtimeRow<T>(table: string, id: string | null, initial: T | null): T | null {
  const [row, setRow] = useState<T | null>(initial);
  const statusRef = useRef<string>('CLOSED');

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
  }, [table, id]);

  return row;
}
