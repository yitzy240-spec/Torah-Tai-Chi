'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, Loader2, X, RotateCcw, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { retriggerJob } from '@/app/actions/retrigger-job';
import { cancelJob } from '@/app/actions/cancel-job';

// Ordered list of the pipeline's "happy-path" stages. Terminal states
// (failed/cancelled) aren't in this list — we render those by lighting up the
// last-known stage red instead of adding extra steps.
const STEPS = [
  { key: 'queued',           label: 'Queued' },
  { key: 'loading_parsha',   label: 'Loading parsha' },
  { key: 'generating_plan',  label: 'Writing the plan' },
  { key: 'uploading_refs',   label: 'Uploading references' },
  { key: 'generating_clips', label: 'Generating clips' },
  { key: 'stitching',        label: 'Stitching' },
  { key: 'done',             label: 'Done' },
] as const;

const STEP_LABELS: Record<string, string> = Object.fromEntries(
  STEPS.map((s) => [s.key, s.label]),
);
STEP_LABELS.failed = 'Failed';
STEP_LABELS.cancelled = 'Cancelled';

/** Format a cost value for display. Returns "—" for null/undefined
 * (unknown — Kie didn't return a cost field) instead of fabricating
 * "$0.00" or showing the previous hardcoded $1.20 placeholder. The
 * pipeline now writes the real Kie credits_consumed value when it
 * exposes one; legacy rows from before this change have $1.20 (fake)
 * and will keep showing that until they age out. */
function formatCost(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

type Job = {
  id: string;
  status: string;
  status_message: string | null;
  error_message: string | null;
  parsha_id: string;
  script_id: string | null;
  motion_ref_slug: string | null;
  triggered_at: string | null;
  completed_at: string | null;
  total_cost_usd: number | string | null;
  director_notes: string | null;
  parshiot?: { name: string; book: string } | null;
  scripts?: {
    title: string | null;
    option: string | null;
    draft_text: string | null;
    tldr: string | null;
  } | null;
};

type Clip = {
  id: string;
  index: number;
  voiceover: string;
  status: string | null;
  cost_usd: number | string | null;
  mp4_path: string | null;
};

type TaiChiMove = {
  slug: string;
  english: string;
  pinyin: string;
  visual: string;
  motion_description: string;
};

// Defensive — pipeline could write a partial plan_json. We only render
// fields we can validate at runtime.
type PlanClipShape = {
  index?: number;
  voiceover?: string;
  visual_prompt?: string;
  setting_id?: string;
  duration_s?: number;
};
type PlanShape = {
  title?: string;
  clips?: PlanClipShape[];
  captions?: Record<string, string | undefined>;
};
type ClipPlanRow = {
  plan_json: unknown;
  created_at: string | null;
};

export function JobProgress({
  initialJob,
  initialClips,
  initialTaiChiMove,
  initialClipPlan,
  typicalRun,
}: {
  initialJob: Job;
  initialClips: Clip[];
  initialTaiChiMove: TaiChiMove | null;
  initialClipPlan: ClipPlanRow | null;
  typicalRun: { lowMin: number; highMin: number } | null;
}) {
  const [job, setJob] = useState<Job>(initialJob);
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [clipPlan, setClipPlan] = useState<ClipPlanRow | null>(initialClipPlan);
  // The tai chi move is locked at trigger time and the slug doesn't change
  // mid-run, so it stays as a prop pass-through rather than client state.
  const taiChiMove = initialTaiChiMove;

  // Subscribe to BOTH jobs (by id) and clips (by job_id) so the user sees
  // step transitions and per-clip completions land without a refresh.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`job-${job.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` },
        (payload) => setJob((j) => ({ ...j, ...(payload.new as Partial<Job>) })),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clips', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const next = payload.new as Clip;
          setClips((cs) => {
            if (cs.some((c) => c.id === next.id)) return cs;
            return [...cs, next].sort((a, b) => a.index - b.index);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clips', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const next = payload.new as Clip;
          setClips((cs) =>
            cs.map((c) => (c.id === next.id ? { ...c, ...next } : c)),
          );
        },
      )
      // clip_plans: lets the Clip Plan tab fill in the moment Claude returns,
      // no manual refresh needed. We pick the row with the newest created_at
      // because in theory regen flows could produce more than one row.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clip_plans', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const next = payload.new as ClipPlanRow;
          setClipPlan((prev) => {
            if (!prev) return next;
            const a = prev.created_at ? Date.parse(prev.created_at) : 0;
            const b = next.created_at ? Date.parse(next.created_at) : 0;
            return b >= a ? next : prev;
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clip_plans', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const next = payload.new as ClipPlanRow;
          setClipPlan((prev) => {
            if (!prev) return next;
            const a = prev.created_at ? Date.parse(prev.created_at) : 0;
            const b = next.created_at ? Date.parse(next.created_at) : 0;
            return b >= a ? next : prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id]);

  // Polling fallback: realtime requires the tables to be in the
  // supabase_realtime publication AND the listener to have read RLS.
  // If anything in that chain breaks, the page would silently stop
  // updating. Poll every 4s while in-flight as a safety net — when
  // realtime IS working, the poll is just a no-op duplicate fetch.
  useEffect(() => {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      return;
    }
    const supabase = createClient();
    const tick = async () => {
      const { data: latestJob } = await supabase
        .from('jobs')
        .select('id, status, status_message, error_message, triggered_at, completed_at, total_cost_usd, director_notes')
        .eq('id', job.id)
        .single();
      if (latestJob) setJob((j) => ({ ...j, ...(latestJob as Partial<Job>) }));
      const { data: latestClips } = await supabase
        .from('clips')
        .select('id, index, voiceover, status, cost_usd, mp4_path')
        .eq('job_id', job.id)
        .order('index');
      if (latestClips) setClips(latestClips as Clip[]);
      // clip_plans polling fallback — only fetched while the page is in-flight,
      // which is when the plan can still be written or regenerated.
      const { data: latestPlan } = await supabase
        .from('clip_plans')
        .select('plan_json, created_at')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestPlan) {
        setClipPlan((prev) => {
          if (!prev) return latestPlan as ClipPlanRow;
          const a = prev.created_at ? Date.parse(prev.created_at) : 0;
          const b = latestPlan.created_at ? Date.parse(latestPlan.created_at) : 0;
          return b >= a ? (latestPlan as ClipPlanRow) : prev;
        });
      }
    };
    const timer = setInterval(tick, 4000);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  const done = job.status === 'done';
  const failed = job.status === 'failed';
  const cancelled = job.status === 'cancelled';
  const inFlight = !done && !failed && !cancelled;

  const currentStepIndex = useMemo(() => {
    if (done) return STEPS.length - 1;
    if (failed || cancelled) {
      // Pick the last stage we have evidence of. status_message often names
      // the stage, but the safest fallback is whatever job.status was before
      // we transitioned to failed — which Modal usually leaves as the last
      // pipeline stage. If we can't tell, default to "queued" so the red
      // marker doesn't lie about progress.
      const guess = guessFailedStage(job, clips);
      return Math.max(0, STEPS.findIndex((s) => s.key === guess));
    }
    const idx = STEPS.findIndex((s) => s.key === job.status);
    return idx < 0 ? 0 : idx;
  }, [job, clips, done, failed, cancelled]);

  const failedStageLabel = useMemo(() => {
    if (!failed && !cancelled) return null;
    const stage = STEPS[currentStepIndex];
    return stage?.label ?? 'unknown stage';
  }, [failed, cancelled, currentStepIndex]);

  const headerBadgeVariant = failed
    ? 'destructive'
    : done
      ? 'default'
      : 'secondary';

  const titleParts = [
    job.parshiot?.name,
    job.scripts?.option ? `Option ${job.scripts.option}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            <span>{titleParts.join(' \u00b7 ') || 'Job'}</span>
            <Badge variant={headerBadgeVariant}>
              {STEP_LABELS[job.status] ?? job.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailsPanel
            job={job}
            taiChiMove={taiChiMove}
            clipPlan={clipPlan}
            planExpected={
              // The plan is written during/after the "writing the plan" stage —
              // any in-flight stage from generating_plan onward, or any
              // terminal/done state where we expect a plan to exist.
              ['generating_plan', 'uploading_refs', 'generating_clips', 'stitching', 'done'].includes(
                job.status,
              )
            }
          />

          <StepIndicator
            currentStepIndex={currentStepIndex}
            failed={failed || cancelled}
          />

          {inFlight && job.triggered_at && (
            <ElapsedLine startedAt={job.triggered_at} typicalRun={typicalRun} />
          )}

          {inFlight && <CancelButton jobId={job.id} />}

          {job.status_message && !failed && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {job.status_message}
            </p>
          )}

          {failed && (
            <FailureCallout
              stageLabel={failedStageLabel}
              errorMessage={job.error_message}
              jobId={job.id}
              onOptimisticReset={() => {
                setJob((j) => ({
                  ...j,
                  status: 'queued',
                  status_message: 'Re-triggering...',
                  error_message: null,
                  completed_at: null,
                }));
              }}
              onRevert={(prev) => setJob(prev)}
              snapshot={job}
            />
          )}

          {job.total_cost_usd !== null && job.total_cost_usd !== undefined && (
            <p className="text-xs text-neutral-500">
              Cost so far:{' '}
              <span className="tabular-nums">
                {formatCost(job.total_cost_usd)}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {(clips.length > 0 || job.status === 'generating_clips') && (
        <ClipsSection clips={clips} />
      )}

      {done && <VideoResult jobId={job.id} />}
    </div>
  );
}

// ---------- Details panel (tabbed) -----------------------------------------

type TabKey = 'script' | 'notes' | 'move' | 'plan';

function DetailsPanel({
  job,
  taiChiMove,
  clipPlan,
  planExpected,
}: {
  job: Job;
  taiChiMove: TaiChiMove | null;
  clipPlan: ClipPlanRow | null;
  planExpected: boolean;
}) {
  // Defensive parse — the pipeline can write a partial plan_json mid-run,
  // and we'd rather show a placeholder than crash the page if a future
  // schema change breaks the shape.
  const parsedPlan = useMemo<PlanShape | null>(() => {
    if (!clipPlan) return null;
    try {
      const raw = clipPlan.plan_json;
      if (!raw || typeof raw !== 'object') return null;
      return raw as PlanShape;
    } catch {
      return null;
    }
  }, [clipPlan]);

  const hasScript = !!(
    job.scripts?.title ||
    job.scripts?.draft_text ||
    job.scripts?.tldr ||
    job.scripts?.option
  );
  const hasNotes = !!(job.director_notes && job.director_notes.trim() !== '');
  const hasMove = !!taiChiMove;
  // Show the Plan tab once the plan stage is at-least-reachable so users
  // can see "Generating plan..." instead of having the tab pop in late.
  const showPlanTab = !!parsedPlan || planExpected;

  const availableTabs = useMemo<TabKey[]>(() => {
    const t: TabKey[] = [];
    if (hasScript) t.push('script');
    if (hasNotes) t.push('notes');
    if (hasMove) t.push('move');
    if (showPlanTab) t.push('plan');
    return t;
  }, [hasScript, hasNotes, hasMove, showPlanTab]);

  // Default to the first tab that has content. We hold the user's choice
  // in state but compute the *displayed* active during render so a tab
  // the user clicked away from doesn't get yanked back to "first" when
  // data lands later, and so a tab that disappears (e.g. plan never came)
  // falls back to the first available without an effect-driven re-render.
  const [userChoice, setUserChoice] = useState<TabKey | null>(null);
  const active: TabKey | null =
    userChoice && availableTabs.includes(userChoice)
      ? userChoice
      : (availableTabs[0] ?? null);

  if (availableTabs.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          No details yet — the script and plan will appear here as the job runs.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex flex-wrap gap-1.5">
        {availableTabs.includes('script') && (
          <TabButton active={active === 'script'} onClick={() => setUserChoice('script')}>
            Script
          </TabButton>
        )}
        {availableTabs.includes('notes') && (
          <TabButton active={active === 'notes'} onClick={() => setUserChoice('notes')}>
            Director Notes
          </TabButton>
        )}
        {availableTabs.includes('move') && (
          <TabButton active={active === 'move'} onClick={() => setUserChoice('move')}>
            Tai Chi Move
          </TabButton>
        )}
        {availableTabs.includes('plan') && (
          <TabButton active={active === 'plan'} onClick={() => setUserChoice('plan')}>
            Clip Plan
          </TabButton>
        )}
      </div>
      <div className="mt-3">
        {active === 'script' && <ScriptTab job={job} />}
        {active === 'notes' && <NotesTab notes={job.director_notes} />}
        {active === 'move' && taiChiMove && <MoveTab move={taiChiMove} />}
        {active === 'plan' && (
          <PlanTab plan={parsedPlan} planRowPresent={!!clipPlan} planExpected={planExpected} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // Match the dashboard's existing visual language: card border, neutral
  // text, subtle ring on the active tab.
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-900 ring-1 ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:ring-neutral-700'
          : 'rounded-md border border-transparent px-2.5 py-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
      }
    >
      {children}
    </button>
  );
}

function ScriptTab({ job }: { job: Job }) {
  const s = job.scripts;
  const title = s?.title ?? null;
  const option = s?.option ?? null;
  const tldr = s?.tldr ?? null;
  const draft = s?.draft_text ?? null;
  return (
    <div className="space-y-2">
      {(title || option) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {title && (
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {title}
            </p>
          )}
          {option && (
            <span className="text-xs text-neutral-500">Option {option}</span>
          )}
        </div>
      )}
      {tldr && (
        <p className="text-xs italic text-neutral-600 dark:text-neutral-400">
          {tldr}
        </p>
      )}
      {draft ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          {draft}
        </p>
      ) : (
        !title &&
        !tldr && (
          <p className="text-xs text-neutral-500">No script text on file.</p>
        )
      )}
    </div>
  );
}

function NotesTab({ notes }: { notes: string | null }) {
  if (!notes || notes.trim() === '') {
    return <p className="text-xs text-neutral-500">No director notes.</p>;
  }
  return (
    <p className="whitespace-pre-wrap text-sm italic text-neutral-700 dark:text-neutral-300">
      {notes}
    </p>
  );
}

function MoveTab({ move }: { move: TaiChiMove }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {move.english}
        </p>
        <span className="text-xs italic text-neutral-500">{move.pinyin}</span>
      </div>
      {move.visual && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Visual
          </p>
          <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300">
            {move.visual}
          </p>
        </div>
      )}
      {move.motion_description && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Motion
          </p>
          <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300">
            {move.motion_description}
          </p>
        </div>
      )}
    </div>
  );
}

function PlanTab({
  plan,
  planRowPresent,
  planExpected,
}: {
  plan: PlanShape | null;
  planRowPresent: boolean;
  planExpected: boolean;
}) {
  // Plan row exists but parse failed (malformed JSON / stale schema): show
  // a friendly placeholder rather than a crash or an empty pane.
  if (!plan) {
    if (planRowPresent) {
      return (
        <p className="text-xs text-neutral-500">
          Plan written but couldn&apos;t be displayed yet.
        </p>
      );
    }
    return (
      <p className="flex items-center gap-2 text-xs text-neutral-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        {planExpected ? 'Generating plan…' : 'Plan will appear once Claude finishes writing it.'}
      </p>
    );
  }

  const clips = Array.isArray(plan.clips) ? plan.clips : [];
  const captions = plan.captions ?? null;
  const hasCaptions =
    captions && Object.values(captions).some((v) => typeof v === 'string' && v.trim() !== '');

  return (
    <div className="space-y-3">
      {plan.title && (
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {plan.title}
        </p>
      )}
      {clips.length === 0 ? (
        <p className="text-xs text-neutral-500">Plan has no clips yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {clips.map((clip, i) => (
            <PlanClipBlock key={clip.index ?? i} clip={clip} fallbackIndex={i} />
          ))}
        </ol>
      )}
      {hasCaptions && captions && <CaptionsBlock captions={captions} />}
    </div>
  );
}

function PlanClipBlock({
  clip,
  fallbackIndex,
}: {
  clip: PlanClipShape;
  fallbackIndex: number;
}) {
  // plan_json clips are 0-indexed (per ClipPlan schema). Display 1-based
  // for the non-technical user — "Clip 1" is friendlier than "Clip 0".
  const zeroBased = typeof clip.index === 'number' ? clip.index : fallbackIndex;
  const headerBits = [
    `Clip ${zeroBased + 1}`,
    clip.setting_id || null,
    typeof clip.duration_s === 'number' ? `${clip.duration_s}s` : null,
  ].filter(Boolean) as string[];
  return (
    <li>
      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {headerBits.join(' \u00b7 ')}
      </p>
      <div className="mt-1 space-y-1 pl-3">
        {clip.voiceover && (
          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Voiceover:
            </span>{' '}
            {clip.voiceover}
          </p>
        )}
        {clip.visual_prompt && (
          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Visual:
            </span>{' '}
            {clip.visual_prompt}
          </p>
        )}
      </div>
    </li>
  );
}

function CaptionsBlock({
  captions,
}: {
  captions: Record<string, string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(captions).filter(
    (kv): kv is [string, string] => typeof kv[1] === 'string' && kv[1].trim() !== '',
  );
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        {open ? 'Hide captions' : `Show captions (${entries.length})`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {entries.map(([platform, text]) => (
            <li key={platform} className="text-xs">
              <p className="font-medium text-neutral-700 dark:text-neutral-300">
                {platform}
              </p>
              <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">
                {text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Step indicator ---------------------------------------------------

function StepIndicator({
  currentStepIndex,
  failed,
}: {
  currentStepIndex: number;
  failed: boolean;
}) {
  return (
    <ol className="space-y-1.5">
      {STEPS.map((step, i) => {
        const isPast = i < currentStepIndex;
        const isCurrent = i === currentStepIndex;

        // Final stage on a successful run: render as past (checked) too.
        const isDoneStep = step.key === 'done' && currentStepIndex === STEPS.length - 1 && !failed;

        let circle: React.ReactNode;
        let textCls = '';
        if (failed && isCurrent) {
          circle = (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
              <X className="h-3 w-3" />
            </span>
          );
          textCls = 'text-red-600 dark:text-red-400 font-medium';
        } else if (isPast || isDoneStep) {
          circle = (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
            </span>
          );
          textCls = 'text-neutral-500 dark:text-neutral-500';
        } else if (isCurrent) {
          circle = (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          );
          textCls = 'text-foreground font-medium';
        } else {
          // future
          circle = (
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-700">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
            </span>
          );
          textCls = 'text-neutral-400 dark:text-neutral-600';
        }

        return (
          <li key={step.key} className="flex items-center gap-2.5">
            {circle}
            <span className={`text-sm ${textCls}`}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Cancel button (in-flight jobs) ----------------------------------

function CancelButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelJob(jobId);
      if (res.error) {
        setError(res.error);
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        Cancel this run
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-600 dark:text-neutral-300">
        Cancel? Costs already incurred won&apos;t be refunded.
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={onCancel}
      >
        <XCircle className="h-3.5 w-3.5" />
        {pending ? 'Cancelling…' : 'Yes, cancel'}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
      >
        Keep going
      </button>
      {error && (
        <span className="w-full text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}

// ---------- Elapsed time -----------------------------------------------------

function ElapsedLine({
  startedAt,
  typicalRun,
}: {
  startedAt: string;
  typicalRun: { lowMin: number; highMin: number } | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - new Date(startedAt).getTime());
  // Compact "p25–p75" range from recent done jobs; "n/a yet" until enough
  // history exists rather than a fabricated number.
  const typical = typicalRun
    ? typicalRun.lowMin === typicalRun.highMin
      ? `\u007e${typicalRun.lowMin} min`
      : `${typicalRun.lowMin}\u2013${typicalRun.highMin} min`
    : 'building from history';
  return (
    <p className="text-xs text-neutral-500">
      Started {formatDuration(elapsedMs)} ago{' '}
      <span className="text-neutral-400">{`\u00b7 Typical run: ${typical}`}</span>
    </p>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// ---------- Failure callout + retry -----------------------------------------

function FailureCallout({
  stageLabel,
  errorMessage,
  jobId,
  onOptimisticReset,
  onRevert,
  snapshot,
}: {
  stageLabel: string | null;
  errorMessage: string | null;
  jobId: string;
  onOptimisticReset: () => void;
  onRevert: (prev: Job) => void;
  snapshot: Job;
}) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  // Hold a ref to the latest snapshot so handleRetry's optimistic-revert path
  // always reverts to the pre-click state, not whatever closure stale-state
  // React captured. We sync it inside an effect to keep the lint rule happy
  // (no ref writes during render).
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  function handleRetry() {
    // Double-click guard: useTransition's `pending` flips after
    // startTransition is called, so a fast double-click before React
    // commits could fire two retriggerJob calls. The server backstops
    // (rejects when status is no longer failed/cancelled), but the
    // second call's error toast would briefly flash. Bail early.
    if (pending) return;
    setActionError(null);
    const prev = snapshotRef.current;
    onOptimisticReset();
    startTransition(async () => {
      const res = await retriggerJob(jobId);
      if (res.error) {
        onRevert(prev);
        setActionError(res.error);
      }
    });
  }

  const [showDetails, setShowDetails] = useState(false);
  const stage = stageLabel ?? 'the pipeline';

  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">
        Something went wrong during {stage.toLowerCase()}.
      </p>
      <p className="text-xs text-red-700/80 dark:text-red-300/80">
        Click <strong>Try again</strong> to retry. This is usually a temporary issue
        with the AI provider.
      </p>
      {actionError && (
        <p className="text-xs text-red-700 dark:text-red-300">{actionError}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={handleRetry}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {pending ? 'Re-triggering…' : 'Try again'}
        </Button>
        {errorMessage && (
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="text-xs text-red-700/70 underline-offset-2 hover:underline dark:text-red-300/70"
          >
            {showDetails ? 'Hide technical details' : 'Show technical details'}
          </button>
        )}
      </div>
      {showDetails && errorMessage && (
        <pre className="whitespace-pre-wrap break-words rounded bg-red-100/60 p-2 text-[11px] leading-snug text-red-800/80 dark:bg-red-950/50 dark:text-red-300/80">
          {errorMessage}
        </pre>
      )}
    </div>
  );
}

// ---------- Clips section ----------------------------------------------------

function ClipsSection({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) return null;

  const doneCount = clips.filter((c) => c.status === 'done').length;
  // Sum only clips with a real cost. Clips with NULL cost (unknown —
  // Kie didn't return a cost field for that task) are excluded so we
  // don't underreport or fabricate. If ALL clips are NULL we hide the
  // total entirely rather than show $0.
  const knownCostClips = clips.filter(
    (c) => c.cost_usd !== null && c.cost_usd !== undefined,
  );
  const totalCost = knownCostClips.reduce(
    (sum, c) => sum + Number(c.cost_usd ?? 0),
    0,
  );
  const someCostUnknown = knownCostClips.length < clips.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>Clips</span>
          <span className="text-xs font-normal text-neutral-500">
            {doneCount} of {clips.length} done{' '}
            {knownCostClips.length > 0 && (
              <span className="text-neutral-400">
                {`\u00b7 $${totalCost.toFixed(2)}`}
                {someCostUnknown && ' (partial)'}
                {' on clips'}
              </span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {clips.map((clip) => (
          <ClipRow key={clip.id} clip={clip} />
        ))}
      </CardContent>
    </Card>
  );
}

function ClipRow({ clip }: { clip: Clip }) {
  // Modal's pipeline only writes 'pending' (default) or 'done'. We render
  // anything that isn't 'done' as actively generating.
  const isDone = clip.status === 'done';
  const preview =
    clip.voiceover.length > 80
      ? clip.voiceover.slice(0, 80).trimEnd() + '\u2026'
      : clip.voiceover;

  return (
    <div className="flex items-start gap-3 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {clip.index}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {preview}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isDone ? (
            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              Done
            </Badge>
          ) : (
            <Badge variant="outline">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating
            </Badge>
          )}
          <span className="text-xs tabular-nums text-neutral-500">
            {formatCost(clip.cost_usd)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- Final video ------------------------------------------------------

function VideoResult({ jobId }: { jobId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: video } = await supabase
        .from('videos')
        .select('mp4_path')
        .eq('job_id', jobId)
        .single();
      if (!video) return;
      const { data } = supabase.storage.from('videos').getPublicUrl(video.mp4_path);
      setUrl(data.publicUrl);
    })();
  }, [jobId]);

  if (!url) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Final video</CardTitle>
      </CardHeader>
      <CardContent>
        <video src={url} controls className="w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

// ---------- Helpers ----------------------------------------------------------

function guessFailedStage(job: Job, clips: Clip[]): string {
  const msg = (job.status_message ?? '').toLowerCase();
  // Modal's set_status messages mention the stage. Match in reverse-stage order
  // so "Generating 3 of 5 clips" hits generating_clips before substring "loading"
  // could match a stray phrase.
  if (msg.includes('stitching') || msg.includes('crossfading')) return 'stitching';
  if (msg.includes('clip')) return 'generating_clips';
  if (msg.includes('reference') || msg.includes('upload')) return 'uploading_refs';
  if (msg.includes('plan')) return 'generating_plan';
  if (msg.includes('parsha') || msg.includes('loading')) return 'loading_parsha';
  // Fallback: if any clips exist, we definitely got past plan/refs.
  if (clips.length > 0) return 'generating_clips';
  return 'queued';
}
