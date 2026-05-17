// dashboard/src/hooks/use-realtime-row.ts
//
// Subscribes to a single Supabase row by its id. Returns the latest
// snapshot of the row, updating in real-time as the row changes.
// Handles INSERT, UPDATE, and DELETE events from postgres_changes.
// Cleanup removes the channel on unmount or when id/table changes.

'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeRow<T>(table: string, id: string | null, initial: T | null): T | null {
  const [row, setRow] = useState<T | null>(initial);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, id]);

  return row;
}
