import { createServiceClient } from '@/lib/supabase/service';

/**
 * Actors that can emit an execution_event. Keep in sync with the CHECK
 * constraint on execution_events.actor. If you need a new actor, add it
 * to both here and the Supabase migration.
 */
export type EventActor =
  | 'yonah'
  | 'pipeline'
  | 'modal'
  | 'buffer'
  | 'youtube'
  | 'ai-image'
  | 'ai-video'
  | 'storyblok'
  | 'supabase'
  | 'system';

/**
 * Severity levels mirror what the Diagnostics viewer filters on.
 * - info: successful lifecycle step, status transition, etc.
 * - warn: recoverable issue (retried, fell through to fallback)
 * - error: unrecoverable failure — needs human attention
 * - action: a human-driven action that changes state (edit, broadcast, schedule)
 */
export type EventLevel = 'info' | 'warn' | 'error' | 'action';

export interface LogEventArgs {
  actor: EventActor;
  level: EventLevel;
  /** Short snake-case code e.g. "broadcast.channel.ok" — shown in viewer */
  event: string;
  subjectType?: string;
  subjectId?: string;
  /** Human-readable one-liner. Always keep short. */
  message: string;
  /** JSON-serialisable payload; stack traces, response bodies, etc. */
  details?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget logger for diagnostic events. NEVER throws — any
 * failure (network, auth, missing table) is swallowed and warned to the
 * server console so the caller's main path can't be broken by logging.
 *
 * We don't `await` fetch itself; the service-client insert is a Promise
 * which we deliberately don't surface. Callers who want back-pressure
 * should build it themselves.
 */
export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    const svc = createServiceClient();
    const { error } = await svc.from('execution_events').insert({
      actor: args.actor,
      level: args.level,
      event: args.event,
      subject_type: args.subjectType ?? null,
      subject_id: args.subjectId ?? null,
      message: args.message,
      details: args.details ?? null,
    });
    if (error) {
      console.warn('[events] insert failed:', error.message, { event: args.event });
    }
  } catch (e) {
    console.warn('[events] logEvent threw (swallowed):', e instanceof Error ? e.message : String(e));
  }
}
