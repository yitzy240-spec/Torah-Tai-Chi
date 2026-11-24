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
import { eventForGeneration, type GenerationTagged } from '@/lib/job-stream-generation';
import {
  type JobEvent,
  isTerminalStage,
  broadcastChannel,
  BROADCAST_EVENT_NAME,
} from '@/lib/job-event-types';

/**
 * @param generation Bump to drop the last event and re-subscribe. Phase 4
 *   bumps it when a re-stitch starts: the compose job is re-run in place, so
 *   the previous stitch's terminal event must not count, and the channel
 *   (closed on that terminal event) has to be reopened.
 */
export function useJobStream(jobId: string | null, generation = 0): JobEvent | null {
  const [state, setState] = useState<GenerationTagged<JobEvent>>({
    generation,
    event: null,
  });

  useEffect(() => {
    if (!jobId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(broadcastChannel(jobId), {
        config: { broadcast: { self: false, ack: false } },
      })
      .on('broadcast', { event: BROADCAST_EVENT_NAME }, (msg) => {
        const payload = msg.payload as JobEvent;
        setState({ generation, event: payload });
        if (isTerminalStage(payload.stage)) {
          supabase.removeChannel(channel);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, generation]);

  // Filtered synchronously so a bumped generation hides the old event in
  // the very render that bumped it (before the effect re-subscribes).
  return eventForGeneration(state, generation);
}
