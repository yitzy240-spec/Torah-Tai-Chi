# Director Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Yonah an optional free-form text field — "Director notes" — that flows into the director-agent prompt as scene/feel guidance, persistent on parsha scripts and per-run on topic jobs.

**Architecture:** Add `director_notes` columns to both `scripts` and `jobs` (snapshot pattern: `scripts.director_notes` is the canonical persisted value, `jobs.director_notes` is the snapshot the Modal worker reads at run time). The director agent (`build_prompt` / `transform_draft_to_clip_plan` in `src/script_generator.py`) gains an optional argument that, when non-empty, injects a "DIRECTION FROM YONAH" block into the prompt scoped as scene-only guidance. Three UI surfaces touch it: the script-card editor (persistent), the GenerateDialog (per-run, writes back), and the topic AiVideoPanel (per-run only).

**Tech Stack:** Python 3 + pytest + httpx (backend); Next.js 15 + Supabase + TypeScript (dashboard); raw SQL migrations under `dashboard/supabase/migrations/`.

**Spec:** [docs/superpowers/specs/2026-04-28-director-notes-design.md](../specs/2026-04-28-director-notes-design.md)

---

## Task 1: Supabase migration — add `director_notes` columns

**Files:**
- Create: `dashboard/supabase/migrations/20260428_director_notes.sql`

- [ ] **Step 1: Create the migration file**

Create `dashboard/supabase/migrations/20260428_director_notes.sql` with:

```sql
-- Director notes: optional free-form Yonah guidance ("set the outdoor clips
-- by a slow river") that the director agent receives as scene/feel context,
-- not as structural overrides. `scripts.director_notes` persists across
-- re-runs; `jobs.director_notes` is a per-run snapshot that the Modal worker
-- reads — once a job is queued, later edits to the script's notes don't
-- affect the running pipeline.

alter table scripts add column if not exists director_notes text;
alter table jobs    add column if not exists director_notes text;
```

- [ ] **Step 2: Apply the migration to the dev DB**

Run from the project root:

```bash
cd dashboard && supabase db push
```

Expected: migration applied, no errors. If `supabase` CLI isn't available, the operator can run the SQL manually against the Supabase dashboard SQL editor.

- [ ] **Step 3: Verify columns exist**

```bash
cd dashboard && supabase db dump --schema public 2>/dev/null | grep -E "director_notes|scripts|jobs" | head -20
```

Expected: `director_notes text` appears in both the `scripts` and `jobs` table definitions.

- [ ] **Step 4: Commit**

```bash
git add dashboard/supabase/migrations/20260428_director_notes.sql
git commit -m "db: add director_notes to scripts and jobs"
```

---

## Task 2: Director-agent prompt — add `director_notes` parameter to `build_prompt`

**Files:**
- Modify: `src/script_generator.py` (function `build_prompt` around line 333; signature + body)
- Test: `tests/test_script_generator.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_script_generator.py`:

```python
def test_build_prompt_omits_director_notes_block_when_none():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes=None,
    )
    assert "DIRECTION FROM YONAH" not in prompt


def test_build_prompt_omits_director_notes_block_when_empty():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes="   ",
    )
    assert "DIRECTION FROM YONAH" not in prompt


def test_build_prompt_includes_director_notes_block_when_provided():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes="set the outdoor clips by a slow river",
    )
    assert "DIRECTION FROM YONAH" in prompt
    assert "set the outdoor clips by a slow river" in prompt
    assert "NOT structural overrides" in prompt
    # The block must come before the closing tail so the tail's instruction
    # to produce the JSON remains the last thing the model reads.
    assert prompt.index("DIRECTION FROM YONAH") < prompt.index("Produce the ClipPlan JSON now")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_script_generator.py::test_build_prompt_omits_director_notes_block_when_none tests/test_script_generator.py::test_build_prompt_omits_director_notes_block_when_empty tests/test_script_generator.py::test_build_prompt_includes_director_notes_block_when_provided -v
```

Expected: all three FAIL with `TypeError: build_prompt() got an unexpected keyword argument 'director_notes'`.

- [ ] **Step 3: Update `build_prompt` signature and body**

In `src/script_generator.py`, change the `build_prompt` function:

```python
def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str,
                 selected_move: dict | None = None,
                 director_notes: str | None = None) -> str:
    base = (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n\n"
        f"DRAFT SCRIPT (preserve wording exactly — you split it, you do not rewrite it):\n"
        f"---\n{draft}\n---\n\n"
    )
    featured = ""
    if selected_move is not None:
        featured = (
            "FEATURED TAI CHI MOVE (Yonah selected this):\n"
            f"- Name: {selected_move['english']} ({selected_move['pinyin']})\n"
            f"- Posture: {selected_move['visual']}\n"
            f"- Motion: {selected_move['motion_description']}\n\n"
            "This move is a DELIBERATE, NARRATED teaching moment — not background\n"
            "motion. Rav Eli announces the move by name and briefly says why\n"
            "it's relevant to the beat, then performs it while continuing the\n"
            "teaching. Three rules:\n\n"
            "1. Pick exactly ONE dojo clip (which MUST have setting_id='DOJO')\n"
            "   whose voiceover beat pairs thematically with this move. On\n"
            "   that clip, emit an extra field: "
            f'"motion_ref_slug": "{selected_move["slug"]}".\n\n'
            "2. On the featured clip, Rav Eli must ANNOUNCE the move by\n"
            "   English name and briefly say why it's relevant to the beat,\n"
            "   then teach through it. The move is intentional and\n"
            "   narrated, not background motion. Shape that clip's\n"
            "   voiceover to make the announcement natural.\n"
            f'   Example: "This is {selected_move["english"]} — the yielding\n'
            '   moment before you rise. When we sink, we\'re not collapsing.\n'
            '   We\'re making room for what comes next." Budget duration_s\n'
            "   for the announcement + ~15 words of teaching.\n\n"
            "3. In the featured clip's visual_prompt, write Rav Eli performing\n"
            "   this move as the primary physical action, weaving the motion\n"
            "   description into scene direction (don't paste verbatim — direct\n"
            "   the scene with it). The other dojo clips show Rav Eli "
            "teaching,\n"
            "   speaking, sitting, gesturing naturally — NOT doing tai chi\n"
            "   motions. The featured move is the single dedicated tai-chi\n"
            "   moment of the video; other dojo beats are Rav Eli as teacher.\n\n"
        )
    director_block = ""
    if director_notes and director_notes.strip():
        director_block = (
            "DIRECTION FROM YONAH (apply within the existing rules above —\n"
            "these are scene/feel guides, NOT structural overrides; do not\n"
            "change clip count, ordering, camera-verb list, archetype menu,\n"
            "or WPS caps to satisfy them):\n"
            f"{director_notes.strip()}\n\n"
        )
    tail = (
        "Produce the ClipPlan JSON now. Remember: 3-8 clips, dojo first then "
        "outdoor, total 28-90 seconds based on natural sage pace (~2.3 wps). "
        "Include the full 'captions' object with all six platform variants "
        "(tiktok, instagram, youtube_title, youtube_description, facebook, "
        "twitter)."
    )
    return base + featured + director_block + tail
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_script_generator.py::test_build_prompt_omits_director_notes_block_when_none tests/test_script_generator.py::test_build_prompt_omits_director_notes_block_when_empty tests/test_script_generator.py::test_build_prompt_includes_director_notes_block_when_provided -v
```

Expected: all three PASS.

- [ ] **Step 5: Run the full test_script_generator suite to confirm no regression**

```bash
pytest tests/test_script_generator.py -v
```

Expected: all tests pass (existing tests don't touch `director_notes`, so the new optional kwarg shouldn't break them).

- [ ] **Step 6: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(director): add director_notes to build_prompt"
```

---

## Task 3: Plumb `director_notes` through `transform_draft_to_clip_plan`

**Files:**
- Modify: `src/script_generator.py` (function `transform_draft_to_clip_plan`, signature + the `build_prompt` call)
- Test: `tests/test_script_generator.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_script_generator.py`:

```python
@pytest.mark.asyncio
@respx.mock
async def test_transform_draft_forwards_director_notes_to_prompt():
    """transform_draft_to_clip_plan must forward director_notes into the
    Claude request body so the agent sees the DIRECTION FROM YONAH block."""
    captured: dict = {}

    def _record(request):
        body = json.loads(request.content)
        captured["messages"] = body["messages"]
        return Response(200, json=_kie_claude_response_body(_fake_plan_with_captions()))

    respx.post(KIE_CLAUDE_URL).mock(side_effect=_record)

    await transform_draft_to_clip_plan(
        parsha_name="Vayikra", book="Leviticus", option="A",
        style_note="lens", title="t",
        draft="[HOOK]\nHe called.",
        api_key="test-key",
        director_notes="set the outdoor clips by a slow river",
        max_retries=1,
    )

    user_content = captured["messages"][0]["content"]
    assert "DIRECTION FROM YONAH" in user_content
    assert "set the outdoor clips by a slow river" in user_content
```

If `pytest-asyncio` isn't already installed and `@pytest.mark.asyncio` isn't recognized, look at how other async tests in the file are decorated and copy that style instead — then adapt the test accordingly. Run `grep -n "asyncio" tests/test_script_generator.py` to find the existing pattern.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pytest tests/test_script_generator.py::test_transform_draft_forwards_director_notes_to_prompt -v
```

Expected: FAIL with `TypeError: transform_draft_to_clip_plan() got an unexpected keyword argument 'director_notes'`.

- [ ] **Step 3: Update `transform_draft_to_clip_plan`**

In `src/script_generator.py`, modify the `transform_draft_to_clip_plan` function — add the new kwarg to the signature and forward it into the `build_prompt` call.

Change the signature (currently around line 395) to add `director_notes`:

```python
async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    api_key: str, model: str = "claude-opus-4-6",
    timeout_s: float = 180.0,
    selected_move: dict | None = None,
    max_retries: int = 3,
    director_notes: str | None = None,
) -> ClipPlan:
```

Update the `build_prompt` call inside the function body (currently around line 414) to pass the new arg:

```python
    prompt = build_prompt(
        parsha_name, book, option, style_note, title, draft,
        selected_move=selected_move,
        director_notes=director_notes,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pytest tests/test_script_generator.py::test_transform_draft_forwards_director_notes_to_prompt -v
```

Expected: PASS.

- [ ] **Step 5: Run the full test_script_generator suite**

```bash
pytest tests/test_script_generator.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(director): forward director_notes through transform_draft_to_clip_plan"
```

---

## Task 4: Modal worker — read `jobs.director_notes`, pass to director agent

**Files:**
- Modify: `modal_app.py` (the SELECT around line 142, both branches that call `transform_draft_to_clip_plan` around line 231)

- [ ] **Step 1: Add `director_notes` to the job SELECT**

In `modal_app.py`, find the block that does (around line 142):

```python
        job = (
            sb.table("jobs")
            .select("kind, parsha_id, script_id, topic, resolution, model_tier, motion_ref_slug")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
```

Change the `.select(...)` to include `director_notes`:

```python
        job = (
            sb.table("jobs")
            .select("kind, parsha_id, script_id, topic, resolution, model_tier, motion_ref_slug, director_notes")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
```

- [ ] **Step 2: Forward `director_notes` to `transform_draft_to_clip_plan`**

In `modal_app.py`, find the call (around line 231):

```python
        plan = asyncio.run(transform_draft_to_clip_plan(
            parsha_name=parsha_name, book=book,
            option=option, style_note=style_note,
            title=title, draft=draft_text,
            api_key=os.environ["KIE_AI_API_KEY"],
            selected_move=selected_move,
        ))
```

Change to:

```python
        plan = asyncio.run(transform_draft_to_clip_plan(
            parsha_name=parsha_name, book=book,
            option=option, style_note=style_note,
            title=title, draft=draft_text,
            api_key=os.environ["KIE_AI_API_KEY"],
            selected_move=selected_move,
            director_notes=job.get("director_notes"),
        ))
```

- [ ] **Step 3: Smoke test — import the worker module**

```bash
python -c "import modal_app; print('imports ok')"
```

Expected: `imports ok`. (No tests for `modal_app.py` exist; the change is a passthrough whose effect is tested at the `transform_draft_to_clip_plan` layer in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add modal_app.py
git commit -m "feat(director): modal worker reads jobs.director_notes and passes through"
```

---

## Task 5: Server action — `saveScriptDraft` accepts `directorNotes`

**Files:**
- Modify: `dashboard/src/app/actions/save-script-draft.ts`

- [ ] **Step 1: Update the action signature and patch**

Replace the function body in `dashboard/src/app/actions/save-script-draft.ts` with:

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/events';
import { revalidatePath } from 'next/cache';

const DIRECTOR_NOTES_MAX_CHARS = 1000;

/**
 * Save edits to a script's draft_text (and optionally title/tldr/director_notes).
 * Auth-checks the session cookie; writes via service-role to bypass RLS.
 *
 * directorNotes semantics:
 *  - undefined  → don't touch the column
 *  - ""         → explicit clear, persists as null
 *  - non-empty  → trimmed, max 1000 chars
 */
export async function saveScriptDraft(args: {
  scriptId: string;
  draftText: string;
  title?: string;
  tldr?: string;
  directorNotes?: string;
  parshaSlug?: string; // for path revalidation
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const draft = args.draftText.trim();
  if (!draft) return { ok: false, error: 'Draft text cannot be empty' };

  const svc = createServiceClient();
  const patch: Record<string, string | null> = { draft_text: draft };
  if (args.title !== undefined) patch.title = args.title.trim();
  if (args.tldr !== undefined) patch.tldr = args.tldr.trim();
  if (args.directorNotes !== undefined) {
    const trimmed = args.directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return { ok: false, error: `Director notes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` };
    }
    patch.director_notes = trimmed === '' ? null : trimmed;
  }

  const { error } = await svc.from('scripts').update(patch).eq('id', args.scriptId);
  if (error) {
    await logEvent({
      actor: 'yonah',
      level: 'error',
      event: 'script.draft.error',
      subjectType: 'script',
      subjectId: args.scriptId,
      message: `Script draft save failed: ${error.message}`,
      details: { parshaSlug: args.parshaSlug, error: error.message },
    });
    return { ok: false, error: error.message };
  }

  await logEvent({
    actor: 'yonah',
    level: 'action',
    event: 'script.draft.saved',
    subjectType: 'script',
    subjectId: args.scriptId,
    message: 'Script draft saved',
    details: {
      parshaSlug: args.parshaSlug,
      draftLength: draft.length,
      titleChanged: args.title !== undefined,
      tldrChanged: args.tldr !== undefined,
      directorNotesChanged: args.directorNotes !== undefined,
      actorUserId: user.id,
    },
  });

  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);
  revalidatePath('/');
  return { ok: true };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors. (If errors appear in unrelated files, that's pre-existing — but errors in `save-script-draft.ts` must be fixed.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/actions/save-script-draft.ts
git commit -m "feat(director): saveScriptDraft accepts directorNotes"
```

---

## Task 6: Server action — `triggerGeneration` accepts `directorNotes`, writes back, snapshots to job

**Files:**
- Modify: `dashboard/src/app/actions/trigger-generation.ts`

- [ ] **Step 1: Update the action**

Replace the function body in `dashboard/src/app/actions/trigger-generation.ts` with:

```typescript
'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

const MONTHLY_BUDGET_USD = 80;
const TYPICAL_DURATION_S = 60; // conservative ballpark before Claude writes the real plan
const DIRECTOR_NOTES_MAX_CHARS = 1000;
const IN_PROGRESS_STATUSES = [
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
];

/**
 * directorNotes semantics:
 *  - undefined  → caller has no notes UI; copy whatever's currently on the script onto the job.
 *  - "" or "   " → user explicitly cleared the field; persist as null on the script, snapshot null onto the job.
 *  - non-empty  → trim, validate length, persist on the script, snapshot onto the job.
 */
export async function triggerGeneration(
  {
    parshaId,
    scriptId,
    partnerParshaId,
    resolution = '720p',
    modelTier = 'standard',
    directorNotes,
  }: {
    parshaId: string;
    scriptId: string;
    partnerParshaId?: string;
    resolution?: Resolution;
    modelTier?: ModelTier;
    directorNotes?: string;
  },
): Promise<{ jobId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Idempotency — block if an active job already exists for this parsha+script.
  const { data: existing } = await supabase
    .from('jobs')
    .select('id')
    .eq('parsha_id', parshaId)
    .eq('script_id', scriptId)
    .in('status', IN_PROGRESS_STATUSES)
    .limit(1);
  if (existing && existing.length > 0) {
    return { error: 'A video is already being generated for this parsha and script. Wait for it to finish.' };
  }

  // Read the script's optional motion reference + persistent director_notes so
  // we can copy them onto the job — Modal reads jobs.* as the single source of
  // truth regardless of parsha vs topic origin.
  const { data: scriptRow } = await supabase
    .from('scripts')
    .select('motion_ref_slug, director_notes')
    .eq('id', scriptId)
    .maybeSingle();
  const motionRefSlug = (scriptRow?.motion_ref_slug ?? null) as string | null;
  let scriptDirectorNotes = (scriptRow?.director_notes ?? null) as string | null;

  // If the dialog passed directorNotes, normalize and persist back to the script
  // before we snapshot to the job, so the script and job agree.
  if (directorNotes !== undefined) {
    const trimmed = directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return { error: `Director notes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` };
    }
    const next = trimmed === '' ? null : trimmed;
    if (next !== scriptDirectorNotes) {
      const svc = createServiceClient();
      const { error: updateErr } = await svc
        .from('scripts')
        .update({ director_notes: next })
        .eq('id', scriptId);
      if (updateErr) return { error: `Could not save director notes: ${updateErr.message}` };
    }
    scriptDirectorNotes = next;
  }

  // Monthly cost cap — block if adding this run would blow the budget.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const { data: costRows } = await supabase
    .from('cost_events')
    .select('cost_usd')
    .gte('created_at', startOfMonth.toISOString());
  const monthlySpend = (costRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const estimated = estimateSeedanceCost(TYPICAL_DURATION_S, resolution, modelTier) ?? 15;
  if (monthlySpend + estimated > MONTHLY_BUDGET_USD) {
    return {
      error: `Monthly budget of $${MONTHLY_BUDGET_USD} would be exceeded: $${monthlySpend.toFixed(2)} already spent + $${estimated.toFixed(2)} estimated for this run. Wait for next month or raise MONTHLY_BUDGET_USD in trigger-generation.ts.`,
    };
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      partner_parsha_id: partnerParshaId ?? null,
      status: 'queued',
      triggered_by: user.id,
      resolution,
      model_tier: modelTier,
      motion_ref_slug: motionRefSlug,
      director_notes: scriptDirectorNotes,
    })
    .select('id').single();

  if (error || !job) return { error: error?.message ?? 'Insert failed' };

  // Fire-and-forget the Modal worker. The worker posts status back to Supabase.
  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) {
    return { error: 'MODAL_WORKER_URL not set' };
  }
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: job.id }),
      // Don't await the response body; the worker takes 15-30 min.
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // It's OK if the fetch aborts — Modal accepts the job and continues.
    // Only fail if we can't even dispatch.
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      return { error: String(e) };
    }
  }

  return { jobId: job.id };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors in `trigger-generation.ts`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/actions/trigger-generation.ts
git commit -m "feat(director): triggerGeneration writes script + snapshots to job"
```

---

## Task 7: Topic flow API route — accept `directorNotes` in POST

**Files:**
- Modify: `dashboard/src/app/api/compose/generate-video/route.ts` (POST handler)

- [ ] **Step 1: Update the POST handler**

In `dashboard/src/app/api/compose/generate-video/route.ts`, change the POST handler's body parsing + validation + insert. Replace the relevant section with:

```typescript
const DIRECTOR_NOTES_MAX_CHARS = 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { topic?: string; moveSlug?: string | null; directorNotes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const topic = body.topic?.trim();
  if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  if (topic.length > 2000) return NextResponse.json({ error: 'topic too long (max 2000 chars)' }, { status: 400 });

  let directorNotes: string | null = null;
  if (typeof body.directorNotes === 'string') {
    const trimmed = body.directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return NextResponse.json(
        { error: `directorNotes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` },
        { status: 400 },
      );
    }
    directorNotes = trimmed === '' ? null : trimmed;
  }

  const moveSlugInput = body.moveSlug ?? null;
  // ...rest of the existing handler unchanged through the .insert call...
```

Then update the `.insert({...})` call later in the same POST handler (this route only handles topic jobs; the parsha flow goes through `triggerGeneration` separately) to include the new column:

```typescript
  const { data: job, error: insertErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'topic',
      topic,
      status: 'queued',
      triggered_by: user.id,
      resolution,
      model_tier: modelTier,
      motion_ref_slug: validatedMoveSlug,
      director_notes: directorNotes,
    })
    .select('id').single();
```

The rest of the file (GET handler, helpers) stays unchanged.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors in this route file.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/api/compose/generate-video/route.ts
git commit -m "feat(director): topic generate-video route accepts directorNotes"
```

---

## Task 8: Script-carousel UI — director notes textarea on the script card

**Files:**
- Modify: `dashboard/src/components/script-carousel.tsx`

- [ ] **Step 1: Add `director_notes` to the `CarouselScript` interface**

In `dashboard/src/components/script-carousel.tsx`, find the `CarouselScript` interface (around line 11) and add:

```typescript
export interface CarouselScript {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
  director_notes: string | null;
  motion_ref_slug: string | null;
  parsha_id?: string | null;
  parsha_name?: string | null;
  parsha_slug?: string | null;
}
```

Then find every server-side query that builds `CarouselScript[]` and add `director_notes` to its `.select(...)` list. Run this to find them:

```bash
grep -rn "draft_text" dashboard/src/app --include="*.ts" --include="*.tsx" | grep -i "select"
```

For each `.select('...')` that lists `draft_text`, add `, director_notes`. Example: a `.select('id, option, title, tldr, draft_text, motion_ref_slug')` becomes `.select('id, option, title, tldr, draft_text, motion_ref_slug, director_notes')`.

- [ ] **Step 2: Add local state and editing affordance for director notes**

Inside the per-script card sub-component in `script-carousel.tsx` (the one that already has `draft`, `editing`, `setSaveError`, etc. — search for `setDraft(script.draft_text ?? '')`), add new state alongside the existing draft state:

```typescript
const [directorNotes, setDirectorNotes] = useState(script.director_notes ?? '');
```

Right after the existing `useMemo` that resets `draft` on script change (around line 340), extend it to reset director notes too:

```typescript
useMemo(() => {
  setDraft(script.draft_text ?? '');
  setDirectorNotes(script.director_notes ?? '');
  setEditing(false);
  setSaveError(null);
  setJustSaved(false);
}, [script.id]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Pass directorNotes through `saveScriptDraft`**

Update the existing `save` function inside the same sub-component:

```typescript
const save = async () => {
  setSaveError(null);
  setSaving(true);
  try {
    const res = await saveScriptDraft({
      scriptId: script.id,
      draftText: draft,
      directorNotes,
      parshaSlug,
    });
    if (!res.ok) {
      setSaveError(res.error ?? 'Save failed');
      return;
    }
    setEditing(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
    router.refresh();
  } catch (e) {
    setSaveError(`Save threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setSaving(false);
  }
};
```

And update `cancel`:

```typescript
const cancel = () => {
  setDraft(script.draft_text ?? '');
  setDirectorNotes(script.director_notes ?? '');
  setEditing(false);
  setSaveError(null);
};
```

- [ ] **Step 4: Render the director-notes textarea inside the editing block**

Find the `editing ? (...)` JSX branch (look for the existing `<textarea>` that binds to `draft`). Add a second textarea + label *below* it, before the Save/Cancel buttons:

```tsx
<label
  style={{
    display: 'block',
    fontFamily: 'var(--ff-body)',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--ink-700)',
    marginTop: '14px',
    marginBottom: '6px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  }}
>
  Director notes (optional)
</label>
<textarea
  value={directorNotes}
  onChange={(e) => setDirectorNotes(e.target.value)}
  placeholder='e.g. "set the outdoor clips by a slow river" or "make sure he meditates in the dojo clip"'
  maxLength={1000}
  rows={3}
  style={{
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid var(--ink-200)',
    borderRadius: 'var(--r-sm)',
    fontFamily: 'var(--ff-body)',
    fontSize: '13.5px',
    lineHeight: 1.5,
    color: 'var(--ink-900)',
    background: 'var(--linen-50)',
    resize: 'vertical',
  }}
/>
<div
  style={{
    fontFamily: 'var(--ff-body)',
    fontSize: '11px',
    color: 'var(--ink-500)',
    marginTop: '4px',
    textAlign: 'right',
  }}
>
  {directorNotes.length}/1000
</div>
```

- [ ] **Step 5: Show a small badge on the read-only view when notes are set**

In the non-editing branch of the script card (where the title/draft preview render), add a subtle indicator below the title/tldr area:

```tsx
{script.director_notes && script.director_notes.trim() && (
  <div
    style={{
      fontFamily: 'var(--ff-body)',
      fontSize: '11px',
      color: 'var(--ink-500)',
      fontStyle: 'italic',
      marginTop: '4px',
    }}
    title={script.director_notes}
  >
    Director notes attached · hover to view
  </div>
)}
```

Place it inside the same container that holds the existing read-only TLDR (search for `script.tldr` and place right after that block).

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/script-carousel.tsx dashboard/src/app
git commit -m "feat(director): script card editor + director_notes selects"
```

---

## Task 9: GenerateDialog — collapsible director-notes section, pre-filled from script

**Files:**
- Modify: `dashboard/src/components/generate-dialog.tsx`
- Modify: `dashboard/src/components/script-carousel.tsx` (the three `<GenerateDialog>` callsites already in the file)

- [ ] **Step 1: Add `directorNotes` prop to `GenerateDialog`**

Update the props interface near the top of `dashboard/src/components/generate-dialog.tsx`:

```typescript
interface GenerateDialogProps {
  parshaId: string;
  scriptId: string;
  parshaName: string;
  partnerParshaId?: string;
  expectedDurationS?: number;
  defaultTierKey?: string;
  /** Pre-filled director notes for this script, if any. Empty string ok. */
  directorNotes?: string | null;
  onJobCreated?: (jobId: string) => void;
  triggerLabel?: string;
  triggerVariant?: 'primary' | 'secondary';
}
```

Update the function signature/destructuring to read `directorNotes`:

```typescript
export function GenerateDialog({
  parshaId,
  scriptId,
  parshaName,
  partnerParshaId,
  expectedDurationS = 60,
  defaultTierKey = '720p standard',
  directorNotes: initialDirectorNotes = null,
  onJobCreated,
  triggerLabel = 'Approve · generate video',
  triggerVariant = 'primary',
}: GenerateDialogProps) {
```

- [ ] **Step 2: Add local state + open-time reset for director notes**

Below the existing `useState` calls inside `GenerateDialog`, add:

```typescript
const [notes, setNotes] = useState<string>(initialDirectorNotes ?? '');
const [notesExpanded, setNotesExpanded] = useState<boolean>(
  Boolean(initialDirectorNotes && initialDirectorNotes.trim()),
);
```

In the existing `openDialog` handler, reset both:

```typescript
const openDialog = () => {
  setSelected(defaultOption);
  setError(null);
  setNotes(initialDirectorNotes ?? '');
  setNotesExpanded(Boolean(initialDirectorNotes && initialDirectorNotes.trim()));
  setOpen(true);
  document.body.style.overflow = 'hidden';
};
```

- [ ] **Step 3: Pass notes through to `triggerGeneration`**

Update the `generate` handler:

```typescript
const generate = () => {
  setError(null);
  startTransition(async () => {
    const result = await triggerGeneration({
      parshaId,
      scriptId,
      partnerParshaId,
      resolution: selected.resolution,
      modelTier: selected.tier,
      directorNotes: notes,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    closeDialog();
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3400);
    if (result.jobId && onJobCreated) onJobCreated(result.jobId);
  });
};
```

- [ ] **Step 4: Render the collapsible notes section above the quality picker**

Inside the dialog body, immediately after the `<p>` that says "Pick a different tier just for this run…" and *before* the `<div role="radiogroup">`, insert:

```tsx
<div style={{ marginBottom: '20px' }}>
  <button
    type="button"
    onClick={() => setNotesExpanded(!notesExpanded)}
    aria-expanded={notesExpanded}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontFamily: 'var(--ff-body)',
      fontSize: '12.5px',
      fontWeight: 500,
      color: 'var(--ink-700)',
      background: 'transparent',
      border: 'none',
      padding: '4px 0',
      cursor: 'pointer',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    <span style={{ fontSize: '10px' }}>{notesExpanded ? '▾' : '▸'}</span>
    Director notes (optional)
    {!notesExpanded && notes.trim() && (
      <span
        style={{
          fontFamily: 'var(--ff-body)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: '11.5px',
          color: 'var(--ink-500)',
          textTransform: 'none',
          letterSpacing: 0,
        }}
      >
        — attached
      </span>
    )}
  </button>
  {notesExpanded && (
    <div style={{ marginTop: '8px' }}>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder='e.g. "set the outdoor clips by a slow river" or "make sure he meditates in the dojo clip"'
        maxLength={1000}
        rows={3}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'var(--ff-body)',
          fontSize: '13.5px',
          lineHeight: 1.5,
          color: 'var(--ink-900)',
          background: 'var(--linen-50)',
          resize: 'vertical',
        }}
      />
      <div
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '11px',
          color: 'var(--ink-500)',
          marginTop: '4px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontStyle: 'italic' }}>
          Saved with the script · used for this run.
        </span>
        <span>{notes.length}/1000</span>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 5: Pass `directorNotes` from each GenerateDialog callsite in script-carousel**

In `dashboard/src/components/script-carousel.tsx`, find each of the three `<GenerateDialog ... />` callsites (currently around lines 584, 611, 621). Add `directorNotes={script.director_notes}` to all three:

```tsx
<GenerateDialog
  parshaId={parshaId}
  scriptId={script.id}
  parshaName={parshaName}
  partnerParshaId={partnerParshaId}
  defaultTierKey={defaultTierKey}
  directorNotes={script.director_notes}
  onJobCreated={(jobId) => setJob({ id: jobId, status: 'queued', statusMessage: null, videoId: null })}
  /* triggerLabel / triggerVariant if originally present */
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/generate-dialog.tsx dashboard/src/components/script-carousel.tsx
git commit -m "feat(director): GenerateDialog collapsible notes pre-filled from script"
```

---

## Task 10: AiVideoPanel — director notes textarea for the topic flow

**Files:**
- Modify: `dashboard/src/app/compose/ai-video-panel.tsx`

- [ ] **Step 1: Add local state**

In `dashboard/src/app/compose/ai-video-panel.tsx`, near the existing `const [topic, setTopic] = useState('')`, add:

```typescript
const [directorNotes, setDirectorNotes] = useState('');
```

- [ ] **Step 2: Send `directorNotes` in the POST body**

Find the `fetch('/api/compose/generate-video', { method: 'POST', ... })` call inside the panel. Update the body to include `directorNotes`:

```typescript
body: JSON.stringify({ topic, moveSlug: moveSlug ?? null, directorNotes }),
```

- [ ] **Step 3: Render the textarea below the topic field**

Locate the existing topic `<textarea>` inside `AiVideoPanel`. Immediately below it (still inside the same form/container, before the Submit button), add:

```tsx
<label
  htmlFor="director-notes"
  style={{
    display: 'block',
    fontFamily: 'var(--ff-body)',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--ink-700)',
    marginTop: '14px',
    marginBottom: '6px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  }}
>
  Director notes (optional)
</label>
<textarea
  id="director-notes"
  value={directorNotes}
  onChange={(e) => setDirectorNotes(e.target.value)}
  placeholder='e.g. "set the outdoor clips by a slow river" or "make sure he meditates in the dojo clip"'
  maxLength={1000}
  rows={3}
  disabled={state.kind === 'generating'}
  style={{
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid var(--ink-200)',
    borderRadius: 'var(--r-sm)',
    fontFamily: 'var(--ff-body)',
    fontSize: '13.5px',
    lineHeight: 1.5,
    color: 'var(--ink-900)',
    background: 'var(--linen-50)',
    resize: 'vertical',
  }}
/>
<div
  style={{
    fontFamily: 'var(--ff-body)',
    fontSize: '11px',
    color: 'var(--ink-500)',
    marginTop: '4px',
    textAlign: 'right',
  }}
>
  {directorNotes.length}/1000
</div>
```

(If the panel uses a different existing visual idiom — e.g. wraps fields in a custom Field component — match that instead. The above is a safe fallback that mirrors the script-carousel textarea style.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/compose/ai-video-panel.tsx
git commit -m "feat(director): topic compose panel sends directorNotes"
```

---

## Task 11: End-to-end manual smoke test

This task has no code changes — it verifies the wiring. Run it before considering the feature done.

- [ ] **Step 1: Start the dashboard locally**

```bash
cd dashboard && npm run dev
```

Open the dashboard in a browser.

- [ ] **Step 2: Topic flow with notes**

Go to `/compose`. In the AI video panel, type a topic ("a teaching about humility from Vayikra") and a director note ("set the outdoor clips by a slow river"). Click Generate. Confirm:

- The job row's `director_notes` column equals the trimmed note. Run in the Supabase SQL editor:

```sql
select id, topic, director_notes, status from jobs order by created_at desc limit 1;
```

- The generated video shows the outdoor scene as RIVERSIDE_GROVE (or a clear river setting) without breaking the dojo-first/outdoor-second structure (still has at least one DOJO clip first).

- [ ] **Step 3: Parsha flow — script-card persistence**

Go to `/videos/<some-parsha-slug>`. Click Edit on a script card. In the new Director notes textarea, type "make sure clip 1 is by a willow tree by a river" and save. Confirm:

- The "Director notes attached" indicator appears on the read-only view of the card.
- Re-opening the editor shows the saved value.

```sql
select id, option, director_notes from scripts where id = '<scriptId>';
```

- [ ] **Step 4: Parsha flow — GenerateDialog round-trip**

On the same script card, click Approve · generate video. Confirm:

- The Director notes section is expanded and pre-filled with "make sure clip 1 is by a willow tree by a river".
- Edit it slightly ("make sure clip 1 is by a slow river with a willow tree overhead") and click Generate.
- The script's `director_notes` is now the edited value (script row updated).
- The new job's `director_notes` is the same edited value (snapshot).

```sql
select s.director_notes as script_notes, j.director_notes as job_notes
from scripts s join jobs j on j.script_id = s.id
where s.id = '<scriptId>'
order by j.created_at desc limit 1;
```

- [ ] **Step 5: Parsha flow — clear notes**

On the same script card, edit and clear the Director notes textarea, save. Confirm `scripts.director_notes` is now `NULL`. Then open GenerateDialog again — the section should be collapsed (no badge) and the textarea empty.

- [ ] **Step 6: Verify the prompt block appears in the LLM request**

Look at the most recent successful job's `clip_plans.plan_json` — confirm the resulting `clips[].visual_prompt` references the river/willow scene without breaking dojo-first structure. (No code change here — purely confirming the LLM took the note as scene guidance.)

- [ ] **Step 7: Mark the feature done**

No commit for this task — it's verification, not code. If everything passes, the feature ships. If anything fails, file a follow-up rather than papering over it.

---

## Done

The feature is complete when:

- All Python tests pass: `pytest tests/test_script_generator.py -v`
- `cd dashboard && npx tsc --noEmit` is clean for the changed files
- The Task 11 manual smoke test passes for both flows
