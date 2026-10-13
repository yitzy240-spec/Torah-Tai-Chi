import { createServiceClient } from '@/lib/supabase/service';

/**
 * Actors that can emit an execution_event. NB: prod has NO CHECK on
 * execution_events.actor or .level (verified against the 2026-10-13
 * schema dump) — these unions are the only guard, so keep them in sync
 * with src/events.py.
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    const svc = createServiceClient();
    // execution_events.subject_id is a uuid column. Callers sometimes pass
    // a non-uuid handle (a Kie task id, an unvalidated request id); that
    // 22P02'd and the whole event was silently dropped. Keep the event and
    // move the handle into details instead.
    const subjectIsUuid = !args.subjectId || UUID_RE.test(args.subjectId);
    const details = subjectIsUuid
      ? (args.details ?? null)
      : { ...(args.details ?? {}), subject_ref: args.subjectId };
    const { error } = await svc.from('execution_events').insert({
      actor: args.actor,
      level: args.level,
      event: args.event,
      subject_type: args.subjectType ?? null,
      subject_id: subjectIsUuid ? (args.subjectId ?? null) : null,
      message: args.message,
      details,
    });
    if (error) {
      console.warn('[events] insert failed:', error.message, { event: args.event });
    }
  } catch (e) {
    console.warn('[events] logEvent threw (swallowed):', e instanceof Error ? e.message : String(e));
  }
}
