// dashboard/src/hooks/use-job-stream.ts
//
// Subscribes to Supabase Broadcast channel `job:${jobId}` for live
// progress. Replaces useRealtimeRow on the jobs table.
//
// Why Broadcast instead of postgres_changes: WAL decode is the IO
// burner. Broadcast is a separate Realtime feature that routes
// messages directly between publisher (Modal via service-role REST)
// and subscriber (browser via JS client). No WAL involvement.
//
// Lifecycle:
//   - Subscribe on mount.
//   - Latest event exposed via state.
//   - Unsubscribe + close channel on unmount or terminal stage.

'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  type JobEvent,
  isTerminalStage,
  broadcastChannel,
  BROADCAST_EVENT_NAME,
} from '@/lib/job-event-types';

export function useJobStream(jobId: string | null): JobEvent | null {
  const [event, setEvent] = useState<JobEvent | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(broadcastChannel(jobId), {
        config: { broadcast: { self: false, ack: false } },
      })
      .on('broadcast', { event: BROADCAST_EVENT_NAME }, (msg) => {
        const payload = msg.payload as JobEvent;
        setEvent(payload);
        if (isTerminalStage(payload.stage)) {
          supabase.removeChannel(channel);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  return event;
}
