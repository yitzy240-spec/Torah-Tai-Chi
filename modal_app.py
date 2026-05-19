"""Modal app that runs the Torah Tai Chi pipeline when triggered via HTTP.

Deploy: modal deploy modal_app.py
Worker URL after deploy (e.g. https://<account>--torah-tai-chi-pipeline-trigger.modal.run)
is what Next.js puts in MODAL_WORKER_URL.

The worker itself runs in Modal's Python sandbox. Uses the same src/ modules
as the CLI does — no pipeline logic is duplicated here.
"""
from __future__ import annotations
import asyncio
import hmac
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import modal
from fastapi import HTTPException, Request

app = modal.App("torah-tai-chi-pipeline")

# The Modal image: base Python + ffmpeg + our src/ + dependencies.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        # Note: no more `anthropic` SDK — all Claude calls now go through
        # Kie.ai's Anthropic-compatible endpoint via raw httpx. Single AI
        # billing account (Kie) for the end user.
        "httpx>=0.27.0",
        "pydantic>=2.8.0",
        "python-dotenv>=1.0.0",
        "supabase>=2.6.0",
        "fastapi[standard]>=0.115.0",  # required by @modal.fastapi_endpoint
    )
    .add_local_dir("src", remote_path="/root/src")
    .add_local_dir("references", remote_path="/root/references")
    .add_local_file("parshiot.json", remote_path="/root/parshiot.json")
)


def _load_selected_move(sb, slug: str | None) -> tuple[dict | None, str | None]:
    """Fetch the tai_chi_moves row for the given slug. Returns (move_dict, mp4_url).

    Returns (None, None) if slug is None or the row doesn't exist.
    """
    if not slug:
        return None, None
    row = (
        sb.table("tai_chi_moves")
        .select("slug, english, pinyin, visual, motion_description, mp4_storage_path")
        .eq("slug", slug)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        return None, None
    base = os.environ["SUPABASE_URL"]
    mp4_url = (
        f"{base}/storage/v1/object/public/videos/"
        f"{row['mp4_storage_path'].lstrip('/')}"
    )
    move_dict = {
        "slug": row["slug"],
        "english": row["english"],
        "pinyin": row["pinyin"],
        "visual": row["visual"],
        "motion_description": row["motion_description"],
    }
    return move_dict, mp4_url


# In-flight statuses match the job_status enum values that mean "the
# pipeline is actively working on this job" (see
# dashboard/supabase/migrations/0001_slice1_schema.sql). 'failed' and
# 'cancelled' are NOT in this set — those jobs CAN be re-triggered.
# 'queued' is also NOT here: it's the default state set on insert by
# the dashboard before calling trigger(); rejecting queued would block
# every legitimate first-time call.
_IN_FLIGHT_STATUSES = frozenset({
    "loading_parsha", "generating_plan", "uploading_refs",
    "generating_clips", "verifying", "stitching",
})
_TERMINAL_STATUSES = frozenset({"done"})

# A job stuck in an in-flight status whose triggered_at is older than
# this is assumed to be a dead worker and CAN be re-triggered manually.
# This is the escape hatch for stranded jobs (Modal worker died after
# spawn but before completing). 30 min comfortably exceeds the longest
# legitimate generation (~10-15 min for parsha, ~5 min for topic).
_STUCK_AFTER = timedelta(minutes=30)

# Kie pricing: $5 buys 1000 credits, so $0.005 per credit. Bulk packages
# go down to ~$0.00455/credit at the largest tier — we use the base
# rate for conservative estimates rather than understating cost.
KIE_CREDITS_TO_USD = 0.005


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),  # KIE_AI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),  # PIPELINE_WEBHOOK_SECRET, PIPELINE_TRIGGER_SECRET (later wins, shadows leaked value in torah-tai-chi-env)
    ],
    timeout=60 * 60,  # 1 hour max
)
@modal.fastapi_endpoint(method="POST")
def trigger(payload: dict, request: Request) -> dict:
    # --- Auth: shared-secret header guard ---
    # Without this, the public Modal endpoint would let anyone discovering
    # the URL spawn paid Seedance generations. PIPELINE_TRIGGER_SECRET is
    # distinct from PIPELINE_WEBHOOK_SECRET (which is the outbound webhook
    # from Modal back to the dashboard).
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(f"[trigger] config_error job_id={job_id_for_log} reason=secret-not-set")
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    # Length guard before compare_digest avoids a short timing leak from
    # the constant-time comparison itself when lengths differ.
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(f"[trigger] auth_fail job_id={job_id_for_log} incoming_len={len(incoming)}")
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    # --- Idempotency: don't double-spawn paid generations ---
    # A dashboard double-click, network retry, or replay attack would
    # otherwise queue duplicate Seedance runs (~$1-2 each). We check the
    # current job status and skip if it's terminal or actively in flight.
    # In-flight jobs older than _STUCK_AFTER are treated as stuck (worker
    # died) and re-triggering is allowed.
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(f"[trigger] skip_terminal job_id={job_id} status={status}")
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                # Supabase returns ISO strings; tolerate the trailing Z.
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[trigger] skip_in_flight job_id={job_id} "
                        f"status={status} age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }
                print(
                    f"[trigger] retrigger_stuck job_id={job_id} "
                    f"status={status} age_s={age.total_seconds():.0f}"
                )
            else:
                # In-flight with no triggered_at — schema default should
                # prevent this, but log if it happens so we notice rather
                # than silently re-triggering on every call.
                print(
                    f"[trigger] retrigger_no_triggered_at job_id={job_id} "
                    f"status={status}"
                )

    # Dispatch to the appropriate worker based on the job kind.
    # kind is read from the payload (the TS server actions always send it)
    # and used to route to the correct Modal function. Unrecognised kinds
    # fall through to run_pipeline (legacy behaviour for parsha / topic /
    # compose — those have their own endpoints but some callers still hit
    # the main trigger URL with those kinds).
    kind = (payload.get("kind") or "parsha").lower()
    if kind == "plan-only":
        plan_only_job.spawn(job_id)
    elif kind == "clips-only":
        # Best-effort: store clip_plan_id + clip_indexes onto the job row
        # so clips_only_job can resolve them without needing the payload.
        # These columns may not exist in early deployments (pre-migration);
        # clips_only_job falls back via regen_of_job_id if they're absent.
        clip_plan_id = payload.get("clip_plan_id")
        clip_indexes = payload.get("clip_indexes")  # None or list[int]
        if clip_plan_id or clip_indexes is not None:
            _col_update: dict = {}
            if clip_plan_id:
                _col_update["clip_plan_id"] = clip_plan_id
            if clip_indexes is not None:
                _col_update["clip_indexes"] = clip_indexes
            if _col_update:
                try:
                    sb.table("jobs").update(_col_update).eq("id", job_id).execute()
                except Exception as _col_err:
                    print(
                        f"[trigger] clips-only payload column write failed "
                        f"job_id={job_id} err={_col_err} "
                        f"(columns may not exist yet — clips_only_job will "
                        f"fall back via regen_of_job_id)"
                    )
        clips_only_job.spawn(job_id)
    else:
        run_pipeline.spawn(job_id)
    return {"ok": True, "job_id": job_id}


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def run_pipeline(job_id: str) -> dict | None:
    sys.path.insert(0, "/root")
    # Import after path setup so src/ modules resolve
    from supabase import create_client
    from src.script_generator import transform_draft_to_clip_plan
    from src.topic_pipeline import generate_draft_from_topic
    from src.video_generator import generate_clip, generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.models import ClipPlan
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Defense-in-depth idempotency: even if trigger() somehow lets a
    # terminal job through (e.g. race between two near-simultaneous
    # spawns), bail before any expensive work. We only guard against
    # terminal statuses here — this function is the one that SETS
    # in-flight statuses, so checking those would always self-skip.
    pre = (
        sb.table("jobs")
        .select("status")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        # Mirror every status transition into the diagnostics feed so the
        # dashboard viewer can show a timeline even when jobs.status gets
        # overwritten. log_event never raises.
        log_event(
            sb,
            actor="modal",
            level="info",
            event=f"pipeline.status.{status}",
            subject_type="job",
            subject_id=job_id,
            message=message or status,
            details={"status": status},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        # Bump the job's running total
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading job inputs")
        # `kind` defaults to 'parsha' for legacy rows (see migration
        # 20260420_topic_jobs.sql). Topic jobs have parsha_id/script_id
        # nullable and carry the user-supplied `topic` text instead.
        # resolution + model_tier come from the dashboard's quality-tier
        # picker and determine which Seedance variant runs.
        job = (
            sb.table("jobs")
            .select("kind, parsha_id, script_id, topic, resolution, model_tier, motion_ref_slug, director_notes")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        kind = (job.get("kind") or "parsha").lower()

        # Quality tier: default to 720p standard if null. seedance-2-fast is
        # cheaper/faster; seedance-2 is higher quality.
        resolution = (job.get("resolution") or "720p").lower()
        model_tier = job.get("model_tier") or "standard"
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast" else "bytedance/seedance-2"
        )

        selected_move, motion_ref_mp4_url = _load_selected_move(
            sb, job.get("motion_ref_slug")
        )
        if job.get("motion_ref_slug") and selected_move is None:
            log_event(
                sb,
                actor="modal",
                level="warn",
                event="pipeline.motion_ref.slug_not_found",
                subject_type="job",
                subject_id=job_id,
                message=(
                    f"job references tai_chi_moves slug "
                    f"'{job.get('motion_ref_slug')}' but no such row exists; "
                    f"video will generate without the reference video"
                ),
            )

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        if kind in ("topic", "video_topic"):
            topic_text = (job.get("topic") or "").strip()
            if not topic_text:
                raise ValueError("topic job has no topic text")

            # Ask Claude to write a Rav-Eli-voiced ~45s draft from the
            # user's topic. Reuses the same A-tight voice as parsha jobs.
            set_status("generating_plan", "Writing Rav Eli's script from your topic")
            draft_text = asyncio.run(
                generate_draft_from_topic(
                    topic=topic_text,
                    api_key=os.environ["KIE_AI_API_KEY"],
                    openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                )
            )

            # For downstream prompting we synthesize the usual fields so
            # the clip-plan prompt doesn't need a separate code path.
            # Using "Topic" as the parsha name keeps ClipPlan.parsha valid
            # without claiming a specific weekly reading.
            parsha_name = "Topic"
            book = "Topic"
            option = "A-tight"
            style_note = "Topic-driven short: ~45s, Rav-Eli voice, A-tight style."
            title = topic_text[:80]
        else:
            parsha = (
                sb.table("parshiot")
                .select("name, book")
                .eq("id", job["parsha_id"])
                .single()
                .execute()
                .data
            )
            script = (
                sb.table("scripts")
                .select("option, title, style_note, draft_text")
                .eq("id", job["script_id"])
                .single()
                .execute()
                .data
            )
            parsha_name = parsha["name"]
            book = parsha["book"]
            option = script["option"]
            style_note = script["style_note"] or ""
            title = script["title"]
            draft_text = script["draft_text"]

        # --- Script → ClipPlan via Claude ---
        # Resume short-circuit: if a prior run for this job_id already
        # wrote a clip_plan (e.g. Claude succeeded but Seedance failed
        # downstream and the user hit Try Again), reuse that plan
        # instead of paying for a fresh Claude call. The existing
        # clip-row resume logic below will then reuse any clips that
        # already finished too — net effect: a retry from clip-gen
        # failure resumes at the unfinished clip, no upstream rework.
        existing_plan_row = (
            sb.table("clip_plans")
            .select("plan_json")
            .eq("job_id", job_id)
            .order("created_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if existing_plan_row and existing_plan_row.data:
            set_status(
                "generating_plan",
                "Reusing plan from prior attempt (skipping Claude)",
            )
            print(
                f"[resume] reusing clip_plan for job {job_id} — "
                "skipping transform_draft_to_clip_plan"
            )
            plan = ClipPlan(**existing_plan_row.data["plan_json"])
        else:
            set_status("generating_plan", "Claude is writing the clip plan")
            plan = asyncio.run(transform_draft_to_clip_plan(
                parsha_name=parsha_name, book=book,
                option=option, style_note=style_note,
                title=title, draft=draft_text,
                api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                selected_move=selected_move,
                director_notes=job.get("director_notes"),
            ))
        # Resume-from-partial: a prior failed run may have inserted
        # clip rows AND successfully generated some of them (storage_path
        # populated, mp4 sitting in Supabase Storage). When the new
        # ClipPlan matches an existing clip's voiceover/visual_prompt/
        # setting/duration exactly, we keep that row and reuse the
        # cached mp4 — no Seedance call, no credits spent. Mismatched
        # or missing rows are upserted fresh.
        existing_rows = (
            sb.table("clips")
            .select(
                "index, voiceover, visual_prompt, setting_id, "
                "duration_s, storage_path, status"
            )
            .eq("job_id", job_id)
            .execute()
        )
        existing_by_index: dict[int, dict] = {
            r["index"]: r for r in (existing_rows.data or [])
        }

        def _can_reuse(c, ex):
            return bool(
                ex
                and ex.get("storage_path")
                and ex.get("status") == "done"
                and ex.get("voiceover") == c.voiceover
                and ex.get("visual_prompt") == c.visual_prompt
                and ex.get("setting_id") == c.setting_id
                and int(ex.get("duration_s") or 0) == int(c.duration_s)
            )

        new_indices = {c.index for c in plan.clips}
        reusable_indices: set[int] = {
            c.index for c in plan.clips
            if _can_reuse(c, existing_by_index.get(c.index))
        }

        # Drop any stale clips not in the new plan (e.g. plan got smaller).
        stale_indices = set(existing_by_index.keys()) - new_indices
        if stale_indices:
            sb.table("clips").delete().eq("job_id", job_id).in_(
                "index", list(stale_indices)
            ).execute()

        # Upsert clips that need (re)generation — reusable ones are
        # left untouched so their storage_path/cost_usd survive.
        to_upsert = [
            {
                "job_id": job_id,
                "index": c.index,
                "voiceover": c.voiceover,
                "visual_prompt": c.visual_prompt,
                "setting_id": c.setting_id,
                "duration_s": c.duration_s,
                "motion_ref_slug": c.motion_ref_slug,
                "status": "pending",
                "storage_path": None,
                "cost_usd": None,
            }
            for c in plan.clips if c.index not in reusable_indices
        ]
        if to_upsert:
            sb.table("clips").upsert(
                to_upsert, on_conflict="job_id,index"
            ).execute()

        # Previous final video is always replaced (a new stitch is
        # coming). The clip_plan is preserved if we reused it (resume
        # short-circuit above) or replaced if we generated a fresh one.
        sb.table("videos").delete().eq("job_id", job_id).execute()

        if reusable_indices:
            print(
                f"[modal_app] resume: reusing {len(reusable_indices)} of "
                f"{len(plan.clips)} clips from prior run "
                f"(indices={sorted(reusable_indices)})"
            )

        if existing_plan_row and existing_plan_row.data:
            # Plan was reused — don't write a new clip_plans row or log
            # a fresh ClipPlan-generation cost. The original cost was
            # already logged on the run that produced this plan.
            pass
        else:
            sb.table("clip_plans").insert({
                "job_id": job_id, "plan_json": plan.model_dump(mode="json"),
                "claude_cost_usd": 0.10,
            }).execute()
            # Claude is now billed through Kie (single-vendor consolidation);
            # vendor tag updated so the dashboard cost rollup attributes correctly.
            log_cost("clipplan", "kie", 0.10, "ClipPlan generation (Claude via Kie)")

        if selected_move is not None:
            ref_clips = [c for c in plan.clips if c.motion_ref_slug]
            if len(ref_clips) == 0:
                log_event(
                    sb,
                    actor="modal",
                    level="warn",
                    event="pipeline.motion_ref.ignored",
                    subject_type="job",
                    subject_id=job_id,
                    message=(
                        f"Move '{selected_move['slug']}' was selected but "
                        f"Claude's plan assigned it to zero clips. "
                        f"Video will generate without the reference video."
                    ),
                )

        # --- Upload refs ---
        set_status("uploading_refs", "Uploading character and dojo references")
        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        # --- Generate clips (in parallel — Kie.ai polling is mostly I/O wait) ---
        set_status("generating_clips", f"Generating 0 of {len(plan.clips)} clips")

        async def _generate_all() -> list[Path]:
            completed = 0
            lock = asyncio.Lock()

            async def _one(clip, first_frame_url: str | None = None):
                nonlocal completed
                dest = work_dir / f"clip_{clip.index:02d}.mp4"
                clip_ref_video_url = (
                    motion_ref_mp4_url if clip.motion_ref_slug else None
                )

                # Resume short-circuit: this clip's plan exactly matches a
                # prior run's already-generated mp4 in Storage. Download
                # the cached mp4 to /tmp instead of paying Seedance again.
                # The eligibility check happened earlier in run_pipeline
                # (clips with this index were preserved with status='done'
                # and storage_path set). If the row's status is 'done',
                # we trust the storage_path and reuse.
                if clip.index in reusable_indices:
                    cached = (
                        sb.table("clips")
                        .select("storage_path")
                        .eq("job_id", job_id)
                        .eq("index", clip.index)
                        .maybe_single()
                        .execute()
                    )
                    storage_path = (cached.data or {}).get("storage_path")
                    if storage_path:
                        try:
                            data = sb.storage.from_("videos").download(
                                storage_path
                            )
                            dest.write_bytes(data)
                            async with lock:
                                completed += 1
                                set_status(
                                    "generating_clips",
                                    f"Generating {completed} of "
                                    f"{len(plan.clips)} clips "
                                    f"(reused {len(reusable_indices)} "
                                    f"from prior run)",
                                )
                            print(
                                f"[modal_app] reused clip {clip.index} "
                                f"from {storage_path} (no Seedance call)"
                            )
                            return dest
                        except Exception as e:
                            print(
                                f"[modal_app] cached clip {clip.index} "
                                f"download failed ({e}); regenerating"
                            )
                            # fall through to regenerate

                # Wrap the Seedance call in the verify loop. For
                # run_pipeline (no user feedback yet), checks come
                # from the visual_prompt itself — baseline-correctness
                # only. The loop is bounded at MAX_VERIFY_ATTEMPTS;
                # each iteration uploads the mp4 to Storage so Gemini
                # can fetch it.
                async def _seedance_for_clip(c):
                    clip_jewish_refs = _jewish_refs_for_clip(c, jewish_refs)
                    _path, _meta = await generate_clip_with_meta(
                        kie, c,
                        character_ref_urls=char_refs,
                        dojo_ref_urls=dojo_refs,
                        dest=dest, resolution=resolution,
                        model=seedance_model,
                        reference_video_url=clip_ref_video_url,
                        first_frame_url=first_frame_url,
                        jewish_ref_urls=clip_jewish_refs,
                    )
                    return _path, _meta

                (
                    local_path,
                    kie_meta,
                    total_credits,
                    verify_attempts,
                    verify_status,
                    verify_notes,
                    _checks_used,
                ) = await _generate_clip_with_verify(
                    clip=clip,
                    seedance_call=_seedance_for_clip,
                    job_id=job_id,
                    sb=sb,
                    feedback_text=None,
                    diagnosis=None,
                    kie_api_key=os.environ["KIE_AI_API_KEY"],
                    openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                    set_status_fn=set_status,
                    progress_label=f"clip {clip.index} of {len(plan.clips)}",
                )
                async with lock:
                    completed += 1
                    set_status("generating_clips", f"Generating {completed} of {len(plan.clips)} clips")
                # Kie returns credits used (their pricing model is $5/1000
                # credits = $0.005/credit). Multiply to USD before storing
                # in cost_usd, since downstream callers (dashboard total,
                # cost rollup, monthly budget) all assume USD. We sum
                # across ALL Seedance attempts for this clip — every
                # generation cost real money even if we shipped only
                # the last one.
                real_cost_usd = (
                    total_credits * KIE_CREDITS_TO_USD if total_credits else None
                )
                # Storage upload already happened inside
                # _generate_clip_with_verify (it has to, so Gemini
                # can fetch the mp4). The local path is stable across
                # retries because the helper passes the same dest.
                clip_storage_path = (
                    f"jobs/{job_id}/clips/clip_{clip.index:02d}.mp4"
                )
                clip_update = {
                    "storage_path": clip_storage_path,
                    # Overwrite the legacy "internal/clip_NN.mp4"
                    # placeholder with the real Storage path so any
                    # downstream consumer that reads mp4_path also
                    # benefits from the checkpoint.
                    "mp4_path": clip_storage_path,
                    "status": "done",
                    "cost_usd": real_cost_usd,
                    "completed_at": "now()",
                    "verification_status": verify_status,
                    "verification_attempts": verify_attempts,
                    "verification_notes": verify_notes,
                    # Persist any prompt augmentation the verify loop
                    # applied so the dashboard's clip plan / debug
                    # tools see the prompt that ACTUALLY shipped.
                    "voiceover": clip.voiceover,
                    "visual_prompt": clip.visual_prompt,
                }
                if clip_ref_video_url:
                    clip_update["motion_ref_url"] = clip_ref_video_url
                sb.table("clips").update(clip_update).eq("job_id", job_id).eq("index", clip.index).execute()
                if real_cost_usd is not None:
                    log_cost(
                        "clip", "kie", real_cost_usd,
                        f"clip {clip.index} ({verify_attempts} attempt(s)) "
                        f"verify={verify_status}",
                    )
                else:
                    print(f"[modal_app] no cost field in Kie response for clip {clip.index}; "
                          f"meta keys={list(kie_meta.keys())}")
                return local_path

            # First-frame chaining within same-scene clips.
            # Group consecutive clips by setting_id, preserving plan
            # order. Each group runs serially (clip N+1 starts from
            # clip N's last frame for frame-perfect continuity);
            # groups themselves run in parallel. Trade-off: serializing
            # within a scene group roughly doubles wall-clock for a
            # 4-5 clip plan, but eliminates the visible jerk Yonah
            # complained about at intra-scene boundaries.
            # Chain decision: same setting_id is necessary but NOT sufficient.
            # If the next clip introduces a Jewish ritual keyword the
            # previous didn't have (e.g. setting_id stays "DOJO" but the
            # new clip mentions a Shabbat table), we MUST break the chain
            # — first_frame_url and reference_image_urls are mutually
            # exclusive in Seedance, and the new ritual ref images need
            # to go through. So we'd rather lose the seamless transition
            # than silently strip the ritual visuals.
            def _can_chain(prev_clip, curr_clip) -> bool:
                if prev_clip.setting_id != curr_clip.setting_id:
                    return False
                # Motion ref is mutex with first_frame_url in Seedance.
                # Chaining INTO a motion-ref clip would force the payload
                # layer to drop the chain frame anyway — break here so we
                # don't upload a frame we'd discard.
                if getattr(curr_clip, "motion_ref_slug", None):
                    return False
                prev_kws = _jewish_ref_ids_in_prompt(
                    prev_clip.visual_prompt or ""
                )
                curr_kws = _jewish_ref_ids_in_prompt(
                    curr_clip.visual_prompt or ""
                )
                # If the new clip has any ritual keyword the previous
                # didn't, treat as a fresh scene so ritual refs flow.
                return not (curr_kws - prev_kws)

            groups: list[list] = []
            for c in plan.clips:
                if groups and _can_chain(groups[-1][-1], c):
                    groups[-1].append(c)
                else:
                    groups.append([c])

            async def _run_group(group: list) -> list[Path]:
                paths: list[Path] = []
                prev_mp4: Path | None = None
                for idx_in_group, c in enumerate(group):
                    first_frame_url: str | None = None
                    if prev_mp4 is not None:
                        # Same-scene chain: extract previous-in-group's
                        # last frame, upload to Kie, pass as
                        # first_frame_url. Failures degrade gracefully
                        # to no-chain (Seedance generates from refs
                        # alone — pre-chain behavior).
                        png_path = (
                            work_dir / f"firstframe_{c.index:02d}.png"
                        )
                        try:
                            _extract_last_frame(prev_mp4, png_path)
                            first_frame_url = await _upload_first_frame(
                                kie, png_path
                            )
                            print(
                                f"[firstframe] clip {c.index}: chaining "
                                f"from clip {group[idx_in_group - 1].index} "
                                f"(setting={c.setting_id})"
                            )
                        except Exception as ff_err:
                            print(
                                f"[firstframe] clip {c.index}: extract/"
                                f"upload failed "
                                f"({type(ff_err).__name__}: {ff_err}); "
                                f"falling through to no-chain"
                            )
                            first_frame_url = None
                        finally:
                            # Hygienic cleanup — Modal containers are
                            # ephemeral but no need to bloat /tmp
                            # mid-run.
                            try:
                                if png_path.exists():
                                    png_path.unlink()
                            except Exception:
                                pass
                    else:
                        print(
                            f"[firstframe] clip {c.index}: new scene "
                            f"(setting={c.setting_id}) — no chain"
                        )
                    path = await _one(c, first_frame_url=first_frame_url)
                    paths.append(path)
                    prev_mp4 = path
                return paths

            # Run all scene groups in parallel; flatten in clip-index
            # order. Defensive sort: groups already preserve order, but
            # interleaving keeps the contract explicit.
            group_results = await asyncio.gather(
                *(_run_group(g) for g in groups)
            )
            indexed: list[tuple[int, Path]] = []
            for grp_paths, grp_clips in zip(group_results, groups):
                for c, p in zip(grp_clips, grp_paths):
                    indexed.append((c.index, p))
            indexed.sort(key=lambda pair: pair[0])
            return [p for _, p in indexed]

        clip_paths: list[Path] = asyncio.run(_generate_all())

        # --- Stitch ---
        set_status("stitching", "Crossfading clips into the final video")
        final_mp4 = work_dir / "final.mp4"
        concat_clips(clip_paths, final_mp4)

        # --- Upload final to Supabase Storage ---
        storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                storage_path, f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

        # --- Extract and upload thumbnail ---
        # A thumbnail failure should not fail the whole video; fall through to
        # a placeholder-less insert and let the website render its brand fallback.
        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(thumb_local, f"jobs/{job_id}/thumb.png")
        except Exception as thumb_err:
            print(f"[thumb] skipped for job {job_id}: {type(thumb_err).__name__}: {thumb_err}")

        video_row: dict = {"job_id": job_id, "mp4_path": storage_path}
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        set_status("done", "Video ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # --- Autopilot webhook ---
        # Tell the dashboard the video is ready. The dashboard route
        # checks the current stance and, if 'auto', fans out Buffer +
        # YouTube for this week's Shabbat. Only parsha jobs trigger it —
        # topic jobs have their own in-flight UI in Compose.
        # Failure here must never fail the pipeline; the video row is
        # already committed.
        if kind == "parsha":
            try:
                # We just inserted videos row above; read its id back so
                # the webhook can address the specific video.
                video_lookup = (
                    sb.table("videos")
                    .select("id")
                    .eq("job_id", job_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                )
                video_id = video_lookup[0]["id"] if video_lookup else None

                dashboard_url = os.environ.get("DASHBOARD_URL")
                webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
                if dashboard_url and webhook_secret and video_id:
                    import httpx  # imported lazily so missing webhook config never crashes the pipeline
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                            headers={"x-pipeline-secret": webhook_secret},
                            json={"jobId": job_id, "videoId": video_id},
                        )
                        print(
                            f"[autopilot] webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                        )
                else:
                    print(
                        f"[autopilot] skipped webhook — missing DASHBOARD_URL / PIPELINE_WEBHOOK_SECRET / video_id (job {job_id})"
                    )
            except Exception as hook_err:
                print(
                    f"[autopilot] webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
                )

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        # Best-effort: pull the last status message so the email knows
        # which stage the pipeline died in. If the read fails (e.g. the
        # row got deleted out from under us), fall back to "unknown".
        failed_stage = "unknown"
        try:
            stage_row = (
                sb.table("jobs")
                .select("status_message, status")
                .eq("id", job_id)
                .single()
                .execute()
                .data
            )
            failed_stage = (
                stage_row.get("status_message")
                or stage_row.get("status")
                or "unknown"
            )
        except Exception:
            pass

        sb.table("jobs").update({
            "status": "failed", "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb,
            actor="modal",
            level="error",
            event="pipeline.failed",
            subject_type="job",
            subject_id=job_id,
            message=f"{type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
            },
        )

        # Operator-notification webhook. Wrapped in its own try so a
        # Resend / dashboard outage never masks the original exception
        # — Modal still needs to see the function fail so its own retry
        # / failure surfacing works.
        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx  # lazy import — same pattern as the success webhook above
                with httpx.Client(timeout=5.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-failed",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": job_id,
                            "errorMessage": f"{type(e).__name__}: {e}",
                            "stage": failed_stage,
                        },
                    )
                    print(
                        f"[fail-notify] webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                    )
            else:
                print(
                    f"[fail-notify] skipped webhook — missing DASHBOARD_URL / PIPELINE_WEBHOOK_SECRET (job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[fail-notify] webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
            )

        raise


# Character refs prioritized to the front of the upload order. Goal
# is to guarantee that EVERY clip Seedance renders sees the critical
# anchors for Rav Eli identity, regardless of how MAX_REFS=9 truncates
# when DOJO + Jewish ritual refs eat the budget. Worst-case slot
# count for char refs on a DOJO clip with 2 Jewish refs is 3 (=
# 9 - 4 dojo - 2 jewish), so the first 3 entries here MUST cover
# Rav Eli's defining features holistically.
#
# Balance: kippah (the most-drifty element per Yonah 2026-05-17)
# needs explicit angles, but we can't over-rotate and lose the
# body / posture / logo / shirt anchors. Each of the first 3 entries
# pulls double-duty:
#
#   01_front_neutral       — kippah front + Torah-Tai-Chi LOGO on chest
#                            + navy mandarin-collar shirt + face + beard.
#                            One image, every "what's the character"
#                            feature. Canonical.
#   07_fullbody_yinyang    — full body, yin-yang pose; the original
#                            "continuity anchor" from the reference
#                            pack generation. Body proportions +
#                            hand positioning + posture.
#   10_closeup_thoughtful  — kippah + face high-detail; the angle
#                            that anchors fine kippah size/shape/band.
#
# Adding 05_profile_right at slot 4 covers the side-view kippah seat
# and side body. Slots 5+ are best-effort additional poses.
#
# If Yonah regenerates the reference pack, update these filenames to
# match — otherwise sort falls through to alphabetical and only the
# canonical 01_front_neutral is guaranteed.
_CHAR_PRIORITY: tuple[str, ...] = (
    "01_front_neutral.png",          # kippah + logo + shirt + face
    "07_fullbody_yinyang_pose.png",  # body + posture continuity anchor
    "10_closeup_thoughtful.png",     # kippah + face high detail
    "05_profile_right.png",          # kippah profile + side body
)


async def _upload_dir(kie: "KieClient", dir_path: Path, label: str) -> list[str]:  # noqa: F821
    pngs = sorted(dir_path.glob("*.png"))
    if label == "char":
        priority_index = {
            name: i for i, name in enumerate(_CHAR_PRIORITY)
        }
        pngs.sort(key=lambda p: (
            priority_index.get(p.name, len(_CHAR_PRIORITY)),
            p.name,
        ))
    urls: list[str] = []
    for img in pngs:
        url = await kie.upload_file(img, remote_dir=f"torah-tai-chi/refs/{label}")
        urls.append(url)
    return urls


# ====================================================================
# JEWISH RITUAL REFERENCE IMAGES
# ====================================================================
#
# Seedance has no visual anchor for Jewish ritual nouns ("Shabbat
# candles", "challah") in visual_prompts — left to text alone, the
# model substitutes whatever it learned from training (a candelabra
# instead of two separate candles, generic loaf instead of a covered
# braided challah). Solution: 8 reference photos sourced from
# Wikimedia Commons live in references/jewish/, get uploaded to Kie
# once per pipeline run, and are injected into reference_image_urls
# alongside character + dojo refs whenever a clip's visual_prompt
# mentions a matching Jewish-ritual keyword.
#
# Filenames in references/jewish/ map to ref_ids by stem.
JEWISH_REFS_DIR = Path("/root/references/jewish")

# ref_id -> filename in JEWISH_REFS_DIR (matches Wikimedia downloads).
JEWISH_REF_FILENAMES: dict[str, str] = {
    "shabbat_candles": "shabbat_candles.jpg",
    "shabbat_table": "shabbat_table.jpg",
    "challah_covered": "challah_covered.jpg",
    "challah_uncovered": "challah.jpeg",
    "kiddush_cup": "kiddush_cup.jpg",
    "tefillin_worn": "tefillin_worn.jpg",
    "tallit_worn": "tallit_worn.jpg",
    "lulav_etrog": "lulav_etrog.jpg",
    "sukkah_interior": "sukkah_interior.jpg",
}

# Case-insensitive substring keywords. If clip.visual_prompt contains
# ANY keyword for a given ref, that ref's URL is injected for this clip.
# Multiple ref_ids can match the same keyword — both refs get added
# (deduped by ref_id, capped at MAX_JEWISH_REFS_PER_CLIP). For challah
# specifically: the generic "challah" keyword grabs BOTH the covered
# and uncovered photos so Seedance has variants to learn from. Cover-
# specific phrasing only triggers the covered ref.
JEWISH_REF_KEYWORDS: dict[str, list[str]] = {
    "shabbat_candles": [
        "shabbat candle", "shabbos candle", "lit candle", "candlestick",
        "two candles", "pair of candles",
    ],
    "shabbat_table": [
        "shabbat table", "shabbos table", "shabbat dinner", "set table",
    ],
    "challah_covered": [
        "challah cover", "covered challah", "challah",
    ],
    "challah_uncovered": [
        "challah", "braided bread", "uncovered challah",
    ],
    "kiddush_cup": [
        "kiddush cup", "silver cup", "wine goblet", "wine chalice",
    ],
    "tefillin_worn": [
        "tefillin", "phylactery", "phylacteries", "leather strap on arm",
    ],
    "tallit_worn": [
        "tallit", "tallis", "prayer shawl", "tzitzit",
    ],
    "lulav_etrog": [
        "lulav", "etrog", "four species", "arba minim", "sukkot bundle",
    ],
    "sukkah_interior": [
        "sukkah", "succah", "schach", "sukkot booth",
    ],
}

# Cap per clip — too many ref images dilutes the character/dojo
# anchors and confuses Seedance.
MAX_JEWISH_REFS_PER_CLIP = 3


async def _upload_jewish_refs(kie: "KieClient") -> dict[str, str]:  # noqa: F821
    """Upload Jewish ritual ref photos to Kie once per pipeline run.

    Returns ref_id -> public URL. Missing files are skipped silently
    so the pipeline continues even if a single asset is absent (the
    keyword match for that ref will simply find no URL and skip).
    """
    out: dict[str, str] = {}
    for ref_id, filename in JEWISH_REF_FILENAMES.items():
        path = JEWISH_REFS_DIR / filename
        if not path.exists():
            print(f"[jewish-ref] missing file {path}; skipping {ref_id}")
            continue
        try:
            url = await kie.upload_file(
                path, remote_dir="torah-tai-chi/refs/jewish",
            )
            out[ref_id] = url
        except Exception as e:
            print(
                f"[jewish-ref] upload failed for {ref_id} "
                f"({type(e).__name__}: {e}); continuing without it"
            )
    print(f"[jewish-ref] uploaded {len(out)} of {len(JEWISH_REF_FILENAMES)} refs")
    return out


def _jewish_ref_ids_in_prompt(visual_prompt: str) -> set[str]:
    """Set of jewish ref_ids whose keywords appear in this prompt.

    Used by chain-decision logic in the full pipeline + regen_agent to
    detect when a new clip introduces a ritual keyword its predecessor
    didn't have. If it does, we MUST break first-frame chaining so the
    ritual ref images can flow (refs and first_frame are mutually
    exclusive in Seedance).
    """
    text = (visual_prompt or "").lower()
    found: set[str] = set()
    for ref_id, kws in JEWISH_REF_KEYWORDS.items():
        if any(kw in text for kw in kws):
            found.add(ref_id)
    return found


def _jewish_refs_for_clip(clip, jewish_refs: dict[str, str]) -> list[str]:
    """Return URLs of Jewish refs relevant to this clip's visual_prompt.

    Case-insensitive substring match across JEWISH_REF_KEYWORDS.
    Deduplicates across keywords for the same ref. Caps at
    MAX_JEWISH_REFS_PER_CLIP — too many ref images dilutes the
    character/dojo anchors.
    """
    if not jewish_refs:
        return []
    prompt = (getattr(clip, "visual_prompt", "") or "").lower()
    if not prompt:
        return []
    matches: list[str] = []
    matched_ids: list[str] = []
    seen: set[str] = set()
    for ref_id, keywords in JEWISH_REF_KEYWORDS.items():
        if ref_id in seen:
            continue
        if any(kw in prompt for kw in keywords):
            url = jewish_refs.get(ref_id)
            if url:
                matches.append(url)
                matched_ids.append(ref_id)
                seen.add(ref_id)
                if len(matches) >= MAX_JEWISH_REFS_PER_CLIP:
                    break
    if matched_ids:
        clip_idx = getattr(clip, "index", "?")
        setting = getattr(clip, "setting_id", "?")
        print(
            f"[jewish-ref] clip {clip_idx} (setting={setting}): "
            f"injecting [{', '.join(matched_ids)}]"
        )
    return matches


def _ensure_local(sb, work_dir: Path, storage_path: str) -> Path:
    """Download a Storage clip mp4 into work_dir if not already there.

    Used by surgery: the freshly-regenerated clip is already on local
    disk in work_dir; the rest of the clips need to be pulled back from
    Storage so concat_clips can read them.
    """
    local = work_dir / Path(storage_path).name
    if local.exists():
        return local
    data = sb.storage.from_("videos").download(storage_path)
    local.write_bytes(data)
    return local


# Known phonetic → canonical-transliteration map. Pulled from the
# safe list in src/script_generator.py (which is what Claude is told
# to use when laying out phonetics) plus tai-chi terms Yonah commonly
# uses. Match is whole-word + case-insensitive (so "Ba-MID-bar",
# "Bah-mid-BAR", and "Ba-Mid-Bar" all map to "Bamidbar"). Multi-word
# entries (e.g. "Baal HaTurim") use literal spaces.
#
# Add to this dict when Yonah hits an awkward dephonetization in the
# wild — that's faster than re-architecting and gives us a curated
# voice for the website.
_HEBREW_PHONETIC_MAP: dict[str, str] = {
    # Books of the Torah
    "beh-ray-sheet": "Bereishit",
    "sheh-mote": "Shemot",
    "vah-yeek-rah": "Vayikra",
    "bah-mid-bar": "Bamidbar",
    "ba-mid-bar": "Bamidbar",
    "bamid-bar": "Bamidbar",
    "b’mid-bar": "B'Midbar",
    "b'mid-bar": "B'Midbar",
    "deh-vah-reem": "Devarim",
    # Patriarchs / matriarchs / biblical figures
    "moh-sheh": "Moshe",
    "ah-ha-rone": "Aharon",
    "ahv-rah-hahm": "Avraham",
    "yits-hahk": "Yitzchak",
    "yah-ah-kov": "Yaakov",
    "yo-sef": "Yosef",
    "sah-rah": "Sarah",
    "riv-kah": "Rivka",
    "rah-hel": "Rachel",
    "leh-ah": "Leah",
    "doh-veed": "Dovid",
    "shlo-mo": "Shlomo",
    "el-i-yah-hoo": "Eliyahu",
    # Holy concepts
    "hah-shem": "Hashem",
    "toh-rah": "Torah",
    "shab-bat": "Shabbat",
    "shab-bos": "Shabbos",
    "mish-kahn": "Mishkan",
    "mish-kan": "Mishkan",
    "mish kan": "Mishkan",
    "ye-tzee-aht mits-RAY-eem": "Yetziat Mitzrayim",
    "mits-RAY-eem": "Mitzrayim",
    "mitz-RAY-eem": "Mitzrayim",
    "har sin-eye": "Har Sinai",
    "har see-NIGH": "Har Sinai",
    "ko-hen": "Kohen",
    "ko-hane": "Kohen",
    "le-vi": "Levi",
    "le-VEE": "Levi",
    "tzitz-it": "Tzitzit",
    "tef-illin": "Tefillin",
    "kee-doosh": "Kiddush",
    "chal-lah": "Challah",
    "men-or-AH": "Menorah",
    "shma": "Shema",
    "shmah": "Shema",
    "ah-mein": "Amen",
    # Compound: multi-word phonetics. Must come BEFORE single-word
    # entries that overlap (Python dicts preserve insertion order;
    # we iterate longest-first below to be safe).
    "bah-ahl hah-too-reem": "Baal HaTurim",
    "rash-ee": "Rashi",
    "ram-bam": "Rambam",
    "tal-mood": "Talmud",
    "ge-mar-ah": "Gemara",
    "mish-nah": "Mishnah",
    # Tai chi terms (English-language transliterations of Chinese).
    "ma boo": "Ma Bu",
    "ma booh": "Ma Bu",
    "mah boo": "Ma Bu",
    "dan-ti-yen": "Dan Tien",
    "dan ti-yen": "Dan Tien",
    "dan tee-yen": "Dan Tien",
    "dan teeyen": "Dan Tien",
    "dahn-tee-en": "Dan Tien",
    "qi": "Qi",
    "chi": "Qi",
    "tai chi": "Tai Chi",
    "tai-chi": "Tai Chi",
    "yin-yang": "Yin-Yang",
}


# Regex fallback for hyphenated phonetics not in the dictionary.
# Hyphenated words where at least one segment is 2+ uppercase letters.
_HYPHENATED_PHONETIC_RE = re.compile(r"[A-Za-z’']+(?:-[A-Za-z’']+)+")


def _strip_phonetics(text: str) -> str:
    """Convert phonetic spellings back to readable Hebrew/tai-chi form.

    Two-pass:
      1. Known map: exact (case-insensitive, whole-word) replacements
         for the phonetics Claude is taught to use in script_generator.
         Produces correct transliterations like "Vah-yeek-RAH" → "Vayikra".
      2. Generic fallback: hyphenated words with an ALL-CAPS segment get
         their hyphens stripped and case normalized. Catches phonetics
         not in the dictionary (e.g. one-off names) with a readable
         approximation rather than leaving the phonetic visible.

    Words without a caps segment AND not in the map (e.g. "self-aware",
    "well-being") are left as-is.
    """
    # Pass 1: known map, longest entries first so multi-word phonetics
    # ("bah-ahl hah-too-reem") match before single-word ones.
    for phonetic in sorted(_HEBREW_PHONETIC_MAP.keys(), key=len, reverse=True):
        clean = _HEBREW_PHONETIC_MAP[phonetic]
        # Word-boundary regex, case-insensitive. re.escape handles the
        # hyphens/apostrophes literally.
        pattern = r"(?<![A-Za-z])" + re.escape(phonetic) + r"(?![A-Za-z])"
        text = re.sub(pattern, clean, text, flags=re.IGNORECASE)

    # Pass 2: generic fallback for unknown hyphenated phonetics.
    def _replace(match: "re.Match[str]") -> str:
        word = match.group(0)
        parts = word.split("-")
        has_caps_segment = any(
            len(p) >= 2 and any(c.isalpha() for c in p) and p == p.upper()
            for p in parts
        )
        if not has_caps_segment:
            return word
        joined = "".join(parts)
        if not joined:
            return word
        return joined[0].upper() + joined[1:].lower()
    return _HYPHENATED_PHONETIC_RE.sub(_replace, text)


def _build_spoken_script(clips_in_order: list[dict]) -> str:
    """Build the un-phonetized full script from the current clip voiceovers.

    Called at every stitch point so videos.spoken_script always reflects
    the clips that produced the final mp4 — not the original clip_plan's
    full_script which is stale after per-clip edits. Each clip's voiceover
    becomes its own paragraph; phonetic guides are stripped.

    Tracks Yonah's 2026-05-15 ask: "the script should always reflect the
    current full video selected on screen." Setting it at stitch (not at
    publish) means the website's text matches whatever was just rendered.
    """
    sorted_clips = sorted(clips_in_order, key=lambda c: c.get("index") or 0)
    paragraphs: list[str] = []
    for c in sorted_clips:
        vo = (c.get("voiceover") or "").strip()
        if not vo:
            continue
        paragraphs.append(_strip_phonetics(vo))
    return "\n\n".join(paragraphs)


def _resolve_video_title_fields(sb, job_id: str) -> dict:
    """Return {title, subtitle, description} for the videos row at stitch time.

    Resolution order (spec §11.6):
    1. Look up jobs.script_id + jobs.parsha_id on the given job.
    2. If script_id is NULL (regen job), walk the regen_of_job_id chain
       (bounded at 25 hops, matching the website chain-walk depth) until
       we find a job with a non-NULL script_id.
    3. Fetch scripts.title + scripts.tldr for the resolved script_id.
    4. Fetch parshiot.name for the resolved parsha_id.
    5. If anything fails (row missing, chain exhausted), return nulls so
       the videos insert still succeeds and the website falls back to
       A-tight gracefully.
    """
    try:
        current_id = job_id
        script_id: str | None = None
        parsha_id: str | None = None
        for _ in range(25):
            row = (
                sb.table("jobs")
                .select("script_id, parsha_id, regen_of_job_id")
                .eq("id", current_id)
                .maybe_single()
                .execute()
                .data
            )
            if not row:
                break
            parsha_id = parsha_id or row.get("parsha_id")
            if row.get("script_id"):
                script_id = row["script_id"]
                break
            parent = row.get("regen_of_job_id")
            if not parent:
                break
            current_id = parent

        if not script_id:
            return {"title": None, "subtitle": None, "description": None}

        script_row = (
            sb.table("scripts")
            .select("title, tldr")
            .eq("id", script_id)
            .maybe_single()
            .execute()
            .data
        ) or {}

        parsha_name: str | None = None
        if parsha_id:
            parsha_row = (
                sb.table("parshiot")
                .select("name")
                .eq("id", parsha_id)
                .maybe_single()
                .execute()
                .data
            ) or {}
            parsha_name = parsha_row.get("name")

        return {
            "title": parsha_name,
            "subtitle": script_row.get("title"),
            "description": script_row.get("tldr"),
        }
    except Exception as e:
        print(
            f"[_resolve_video_title_fields] failed for job {job_id}: "
            f"{type(e).__name__}: {e}; title/subtitle/description will be NULL"
        )
        return {"title": None, "subtitle": None, "description": None}


def _extract_last_frame(mp4_path: Path, dest_png: Path) -> Path:
    """Extract the last frame of an mp4 as PNG via ffmpeg.

    Used by the same-scene first-frame chaining: feed clip N's last
    frame as clip N+1's first_frame_url so Seedance starts the next
    clip exactly where the previous one ended (frame-perfect
    continuity within the same setting).

    Raises subprocess.CalledProcessError if ffmpeg fails or
    subprocess.TimeoutExpired if it hangs. Caller is expected to
    catch and degrade to no-chain behavior.
    """
    import subprocess
    # -sseof -0.1 seeks 0.1s before EOF — close enough to grab the
    # final visible frame without risking past-EOF on short clips.
    # -update 1 -frames:v 1 emits exactly one image to dest.
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-sseof", "-0.1",
            "-i", str(mp4_path),
            "-update", "1",
            "-q:v", "1",
            "-frames:v", "1",
            str(dest_png),
        ],
        check=True,
        timeout=30,
        capture_output=True,
    )
    return dest_png


async def _upload_first_frame(kie: "KieClient", png_path: Path) -> str:  # noqa: F821
    """Upload a first-frame PNG to Kie and return the public URL.

    Thin wrapper around KieClient.upload_file (which handles base64
    + mime detection) so call sites read clearly.
    """
    return await kie.upload_file(
        png_path, remote_dir="torah-tai-chi-firstframes"
    )


async def _resolve_regen_first_frame(
    sb,
    parent_job_id: str,
    clip_index: int,
    clip_visual_prompt: str,
    clip_setting_id: str | None,
    motion_ref_slug: str | None,
    kie: "KieClient",  # noqa: F821
    work_dir: Path,
) -> "str | None":
    """Return a first_frame_url to anchor clip N's regen to clip N-1's last
    frame, or None if the regen should fall back to reference images.

    This mirrors the initial-generation chaining logic in run_pipeline
    (_can_chain + _run_group) but works against PARENT JOB clips so
    that a per-clip regen opens exactly where the previous clip ended.

    Eligibility gates (same as initial chaining):
      - clip_index > 0  (clip 0 has no predecessor)
      - motion_ref_slug is None  (first_frame_url and reference_video_urls
        are mutually exclusive in Seedance)
      - clip N-1 exists in parent_job_id's clips table with a storage_path
      - clip N-1 shares the same setting_id as clip N
      - clip N does NOT introduce a Jewish ritual keyword that clip N-1
        didn't have (first_frame_url and reference_image_urls are also
        mutually exclusive — new ritual refs must flow through)

    On any extraction / upload failure the function degrades silently to
    None (fall-through to reference-image-only re-roll). Callers should
    NOT raise on a None return; treat it as "no chain available".
    """
    # Gate 1: clip 0 has no predecessor.
    if clip_index <= 0:
        print(
            f"[firstframe] regen clip {clip_index}: clip 0 — no chain"
        )
        return None

    # Gate 2: motion ref is mutex with first_frame_url in Seedance.
    if motion_ref_slug:
        print(
            f"[firstframe] regen clip {clip_index}: motion_ref present "
            f"({motion_ref_slug}) — skip chain"
        )
        return None

    # Look up clip N-1 on the parent job.
    prev_row = (
        sb.table("clips")
        .select("index, visual_prompt, setting_id, storage_path")
        .eq("job_id", parent_job_id)
        .eq("index", clip_index - 1)
        .maybe_single()
        .execute()
        .data
    ) or {}

    prev_storage_path = prev_row.get("storage_path")

    # Gate 3: clip N-1 must exist and be fully rendered.
    if not prev_row or not prev_storage_path:
        print(
            f"[firstframe] regen clip {clip_index}: clip {clip_index - 1} "
            f"not found or has no storage_path — no chain"
        )
        return None

    # Gate 4: same scene (setting_id).
    prev_setting = prev_row.get("setting_id")
    if prev_setting != clip_setting_id:
        print(
            f"[firstframe] regen clip {clip_index}: different setting "
            f"({prev_setting!r} vs {clip_setting_id!r}) — no chain"
        )
        return None

    # Gate 5: no new Jewish ritual keyword introduced.
    prev_kws = _jewish_ref_ids_in_prompt(prev_row.get("visual_prompt") or "")
    curr_kws = _jewish_ref_ids_in_prompt(clip_visual_prompt or "")
    if curr_kws - prev_kws:
        new_kws = ", ".join(sorted(curr_kws - prev_kws))
        print(
            f"[firstframe] regen clip {clip_index}: new ritual keyword(s) "
            f"introduced ({new_kws}); refs must flow — no chain"
        )
        return None

    # All gates passed — extract the last frame from clip N-1's mp4 and
    # upload it as the anchor for clip N's regen.
    png_path = work_dir / f"firstframe_{clip_index:02d}.png"
    try:
        prev_local = _ensure_local(sb, work_dir, prev_storage_path)
        _extract_last_frame(prev_local, png_path)
        first_frame_url = await _upload_first_frame(kie, png_path)
        print(
            f"[firstframe] regen clip {clip_index}: chained from clip "
            f"{clip_index - 1} (setting={clip_setting_id})"
        )
        return first_frame_url
    except Exception as ff_err:
        print(
            f"[firstframe] regen clip {clip_index}: extract/upload failed "
            f"({type(ff_err).__name__}: {ff_err}); falling through to no-chain"
        )
        return None
    finally:
        try:
            if png_path.exists():
                png_path.unlink()
        except Exception:
            pass


# ====================================================================
# PER-CLIP GEMINI VISUAL VERIFICATION
# ====================================================================
#
# Problem the legacy editor agent couldn't solve: Claude is blind to
# what Seedance actually rendered. The agent's text-only verify step
# checks the new ClipPlan against the user's feedback — but if Seedance
# generates "two candles on separate shelves" despite the prompt
# saying "side by side on the same surface," the bad clip ships and
# the user reports the same issue for the Nth time.
#
# Fix: per-clip Gemini-powered visual verification immediately after
# Seedance produces each new clip, BEFORE stitching. Bounded retry: if
# the clip fails its checks, regenerate ONCE with the failure findings
# augmenting the prompt; second failure ships anyway with
# verification_status='failed' so the user knows which clip to review.
#
# Model selection (per the project's standing rule, verified at impl
# time via openrouter.ai/api/v1/models):
#   google/gemini-3-pro-preview-20260219 — frontier reasoning, 1M ctx,
#   native video input. Currently $2/$12 per 1M tokens — ~$0.20 per
#   short-clip verify pass.
#
# Bound: max 2 attempts per clip. NEVER more. Latency budget
# ~30-60s/verify, accepted because the alternative is the user
# re-running the whole pipeline manually.

# OpenRouter id used for the visual verify call. Pinned to the
# preview snapshot so a silent OR routing change doesn't shift
# behavior under us; bump the date when we test a newer Gemini.
GEMINI_VERIFY_MODEL = "google/gemini-3-pro-preview-20260219"

# Hard cap. Pipeline will never call Seedance more than this many
# times for one clip during one run.
MAX_VERIFY_ATTEMPTS = 2


def _public_clip_url(storage_path: str) -> str:
    """Build the public Supabase Storage URL for a clip mp4.

    Clip mp4s are uploaded to the 'videos' bucket which is configured
    public (per the checkpoint work that made surgery possible).
    Gemini fetches the mp4 from this URL directly — no signed URL,
    no service-key handoff.
    """
    base = os.environ["SUPABASE_URL"].rstrip("/")
    return f"{base}/storage/v1/object/public/videos/{storage_path.lstrip('/')}"


async def _generate_clip_checks(
    *,
    clip_voiceover: str,
    clip_visual_prompt: str,
    feedback_text: str,
    diagnosis: dict | None,
    kie_api_key: str,
    openrouter_api_key: str | None,
) -> list[dict]:
    """Sonnet 4.6 call. Returns a list of {id, claim, feedback_point}
    dicts — concrete, binary visual/audio checks the new clip MUST
    satisfy if the regen actually addressed the user's feedback.

    Returns [] if the model can't ground any concrete checks (unusual
    feedback shape) — verification then short-circuits to 'unchecked'
    rather than failing the pipeline.
    """
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block

    system = (
        "You are generating verification checks for one specific clip. "
        "Given the user's original feedback and the agent's diagnosis, "
        "list the visual or audio claims that this clip MUST satisfy "
        "if the regen succeeded. Be concrete and binary — each check "
        "must be a yes/no observable in the clip. Each claim should "
        "include enough specificity that a vision model watching the "
        "clip could mark it pass/fail without ambiguity (objects, "
        "spatial relationships, counts, pronunciations). Output ONE "
        "JSON object: "
        "{ \"checks\": [ "
        "{\"id\": \"<short snake_case identifier>\", "
        "\"claim\": \"<concrete pass/fail statement about what should "
        "be visible/audible in this clip>\", "
        "\"feedback_point\": \"<which feedback point this check "
        "anchors to, or 'general' if it's a baseline correctness "
        "check>\"} "
        "] }. No markdown fences, no commentary."
    )
    diagnosis_block = (
        _json.dumps(diagnosis, indent=2) if diagnosis else "(no diagnosis available)"
    )
    user_prompt = (
        f"USER FEEDBACK (the issues that drove this regen):\n"
        f"{feedback_text}\n\n"
        f"AGENT DIAGNOSIS:\n{diagnosis_block}\n\n"
        f"CLIP VOICEOVER (what should be heard):\n{clip_voiceover}\n\n"
        f"CLIP VISUAL PROMPT (what should be seen):\n{clip_visual_prompt}\n\n"
        f"List the binary checks that this clip must satisfy. Output JSON only."
    )
    try:
        raw = await claude_call(
            messages=[{"role": "user", "content": user_prompt}],
            system=system,
            model="claude-sonnet-4-6",
            kie_api_key=kie_api_key,
            openrouter_api_key=openrouter_api_key,
            max_tokens=2000,
            log_prefix="[verify.checks]",
        )
        cleaned = _extract_json_block(raw)
        parsed = _json.loads(cleaned)
        checks = parsed.get("checks") or []
        # Mild shape guard — bad rows just get filtered out rather
        # than crashing the whole verify pass.
        valid = []
        for c in checks:
            if not isinstance(c, dict):
                continue
            cid = c.get("id")
            claim = c.get("claim")
            if isinstance(cid, str) and isinstance(claim, str) and claim.strip():
                valid.append({
                    "id": cid,
                    "claim": claim,
                    "feedback_point": c.get("feedback_point") or "general",
                })
        return valid
    except Exception as e:
        # Check generation is itself best-effort. A Sonnet outage must
        # not block the pipeline — degrade to "no checks", which the
        # caller treats as 'unchecked' (skip verify, ship the clip).
        print(
            f"[verify.checks] WARN failed to generate checks: "
            f"{type(e).__name__}: {e}; verify will be skipped for this clip"
        )
        return []


async def _gemini_verify_clip(
    *,
    clip_url: str,
    checks: list[dict],
    openrouter_api_key: str,
) -> dict:
    """Send the clip mp4 URL + the list of checks to Gemini and ask
    it to return pass/fail per check with concrete evidence.

    Returns ``{"results": [{"id", "pass", "evidence"}, ...], "error": None}``
    on success or ``{"results": [], "error": "<reason>"}`` on failure.
    The caller treats the 'error' branch as 'skip verify, ship the
    clip' so a Gemini outage never blocks the pipeline.
    """
    import json as _json

    import httpx

    if not checks:
        return {"results": [], "error": "no checks"}

    system = (
        "You are reviewing one short video clip against a list of "
        "specific claims. For each claim, watch the clip carefully "
        "and determine pass/fail with concrete visual evidence "
        "(timestamp + observation). Be conservative — only mark "
        "fail if you can see clearly that the claim is violated. "
        "If unsure, mark pass. Output ONE JSON object: "
        "{ \"results\": [ "
        "{\"id\": \"<the check id from input>\", "
        "\"pass\": true|false, "
        "\"evidence\": \"<timestamp range + concrete observation, "
        "e.g. '0:08-0:12, two candles visible on same table about 4 "
        "inches apart'>\"} "
        "] }. No markdown fences, no commentary."
    )

    checks_block = _json.dumps(checks, indent=2)
    user_text = (
        f"CHECKS TO EVALUATE (each item has an id, claim, and the "
        f"feedback point it anchors to):\n{checks_block}\n\n"
        f"Watch the clip and output the results JSON now."
    )

    body = {
        "model": GEMINI_VERIFY_MODEL,
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    # OpenRouter's OpenAI-compatible chat schema accepts
                    # video URL parts via the same "image_url" shape the
                    # multimodal Gemini route understands. Type is
                    # "video_url" per OR's docs for video-capable models.
                    {"type": "video_url", "video_url": {"url": clip_url}},
                ],
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as http:
            r = await http.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/yitzy240-spec/Torah-Tai-Chi",
                    "X-Title": "torah-tai-chi-pipeline",
                },
                json=body,
            )
        if r.status_code >= 400:
            return {
                "results": [],
                "error": f"openrouter {r.status_code}: {r.text[:200]}",
            }
        data = r.json()
        choices = data.get("choices") or []
        if not choices:
            return {"results": [], "error": "openrouter returned no choices"}
        content = choices[0].get("message", {}).get("content")
        if not content or not (isinstance(content, str) and content.strip()):
            return {"results": [], "error": "openrouter returned empty content"}
        # Strip optional ```json fences. Reuse the same helper the
        # rest of the pipeline uses so behavior matches.
        from src.script_generator import _extract_json_block
        cleaned = _extract_json_block(content)
        parsed = _json.loads(cleaned)
        results = parsed.get("results") or []
        valid = []
        for res in results:
            if not isinstance(res, dict):
                continue
            rid = res.get("id")
            rpass = res.get("pass")
            if isinstance(rid, str) and isinstance(rpass, bool):
                valid.append({
                    "id": rid,
                    "pass": rpass,
                    "evidence": res.get("evidence") or "",
                })
        return {"results": valid, "error": None}
    except Exception as e:
        # Gemini / OR outage: treat as 'unverified' rather than
        # blocking the pipeline. The caller will mark the clip
        # verification_status='failed' on second-attempt exhaustion,
        # or just leave it 'unchecked' if this is the only attempt.
        return {
            "results": [],
            "error": f"{type(e).__name__}: {e}",
        }


def _verify_results_passed(verify_resp: dict, checks: list[dict]) -> bool:
    """A clip 'passes' verify when:
      - Gemini call succeeded (no error), AND
      - every check id from the input has a result row, AND
      - every result row has pass=true.

    Conservative: a missing result row = fail (not pass), so partial
    Gemini responses don't slip through unverified.
    """
    if verify_resp.get("error"):
        return False
    results = verify_resp.get("results") or []
    pass_by_id = {
        r["id"]: bool(r.get("pass"))
        for r in results
        if isinstance(r, dict) and isinstance(r.get("id"), str)
    }
    for c in checks:
        cid = c.get("id")
        if not isinstance(cid, str):
            continue
        if not pass_by_id.get(cid, False):
            return False
    return True


def _summarize_failed_checks(
    checks: list[dict], verify_resp: dict, max_items: int = 3
) -> str:
    """Render a 1-line summary of the failures to slot into a status
    message ("Retrying clip 3 — gemini flagged X").
    """
    results_by_id = {
        r["id"]: r
        for r in (verify_resp.get("results") or [])
        if isinstance(r, dict) and isinstance(r.get("id"), str)
    }
    failed_claims: list[str] = []
    for c in checks:
        cid = c.get("id")
        if not isinstance(cid, str):
            continue
        res = results_by_id.get(cid)
        # Missing result rows are conservative-failures (per
        # _verify_results_passed). Surface them as "no answer for X".
        if res is None:
            failed_claims.append(c.get("claim") or cid)
            continue
        if not bool(res.get("pass")):
            failed_claims.append(c.get("claim") or cid)
    if not failed_claims:
        # Should only happen if verify_resp itself errored.
        err = verify_resp.get("error") or "verification incomplete"
        return f"verification error: {err}"
    summary = "; ".join(failed_claims[:max_items])
    if len(failed_claims) > max_items:
        summary += f" (+{len(failed_claims) - max_items} more)"
    return summary


def _build_retry_prompt_addendum(
    checks: list[dict], verify_resp: dict
) -> tuple[str, bool]:
    """Build the augmentation appended to visual_prompt (and optionally
    voiceover) on retry. Returns (addendum_text, voiceover_related).

    voiceover_related is True when any failed check anchors a voiceover
    issue (e.g. "Hashem pronounced 'ha-SHEM'" — that's an audio claim,
    not a visual one). The caller uses it to decide whether to also
    augment the voiceover field.
    """
    results_by_id = {
        r["id"]: r
        for r in (verify_resp.get("results") or [])
        if isinstance(r, dict) and isinstance(r.get("id"), str)
    }
    failed_lines: list[str] = []
    voiceover_related = False
    for c in checks:
        cid = c.get("id")
        if not isinstance(cid, str):
            continue
        res = results_by_id.get(cid)
        if res is not None and bool(res.get("pass")):
            continue
        claim = c.get("claim") or cid
        evidence = (res or {}).get("evidence") or ""
        line = f"- {claim}"
        if evidence:
            line += f" (verifier observed: {evidence})"
        failed_lines.append(line)
        # Heuristic: voiceover-related keywords. Cheap and good enough
        # for a retry hint — false positives just nudge the voiceover
        # too, which is harmless.
        anchor = (c.get("feedback_point") or "").lower()
        text = (claim + " " + anchor).lower()
        if any(
            k in text
            for k in ("voiceover", "pronunci", "audio", "spoken", "narration", "tts")
        ):
            voiceover_related = True
    if not failed_lines:
        return "", False
    addendum = (
        "\n\nPRIOR ATTEMPT FAILED these visual checks. Address each "
        "one explicitly:\n" + "\n".join(failed_lines)
    )
    return addendum, voiceover_related


async def _generate_clip_with_verify(
    *,
    clip,
    seedance_call,
    job_id: str,
    sb,
    feedback_text: str | None,
    diagnosis: dict | None,
    kie_api_key: str,
    openrouter_api_key: str | None,
    set_status_fn,
    progress_label: str,
):
    """Shared Seedance + Gemini-verify loop used by both run_pipeline
    and regen_agent.

    Args:
        clip: The pydantic ClipPlan.Clip the call site is about to
            generate. Mutated in place when a retry needs an augmented
            visual_prompt / voiceover (the caller still owns the
            object, so the augmented version is what gets persisted to
            the clips row).
        seedance_call: Async callable (clip) -> tuple[Path, dict].
            The caller wires this to the right
            generate_clip_with_meta invocation (with the right
            char_refs / dojo_refs / motion_ref_url). Returns
            (local_mp4_path, kie_meta).
        job_id: For Storage upload path + diagnostics.
        sb: Supabase service client.
        feedback_text / diagnosis: When called from regen_agent, both
            are populated and drive concrete check generation. When
            called from run_pipeline, both can be None — checks will
            be derived from the visual_prompt itself (baseline
            correctness only).
        set_status_fn: The caller's set_status closure. Used to
            surface "Verifying clip N", "Retrying clip N — gemini
            flagged ..." in the dashboard.
        progress_label: Human label for status messages
            (e.g. "clip 3 of 5"). The caller knows the count; we just
            interpolate.

    Returns ``(local_path, kie_meta_last, total_cost_usd, attempts,
    final_status, last_verify_notes, last_checks)``. The caller is
    responsible for uploading to Storage + writing the clip row.

    Bounded at MAX_VERIFY_ATTEMPTS attempts. Never more, regardless
    of how badly Gemini disagrees with Seedance.
    """
    # Track ALL Seedance attempts' costs — we paid for every regen,
    # not just the one we shipped.
    total_credits = 0.0
    attempts = 0
    last_kie_meta: dict = {}
    last_local_path: Path = Path("/tmp/missing.mp4")
    last_verify_notes: dict = {}
    last_checks: list[dict] = []
    final_status = "unchecked"

    # Cap attempts at MAX_VERIFY_ATTEMPTS. Each iteration: Seedance →
    # upload to Storage so Gemini can fetch → generate checks → call
    # Gemini → if pass, break; if fail and we have budget, augment
    # prompt and loop; if out of budget, mark failed and ship.
    while attempts < MAX_VERIFY_ATTEMPTS:
        attempts += 1
        # ---- Generate (Seedance) ----
        local_path, kie_meta = await seedance_call(clip)
        last_local_path = local_path
        last_kie_meta = kie_meta
        credits = (
            kie_meta.get("creditsConsumed")
            or kie_meta.get("credits_consumed")
            or kie_meta.get("costCredits")
            or kie_meta.get("cost")
        )
        if credits is not None:
            try:
                total_credits += float(credits)
            except (TypeError, ValueError):
                pass

        # ---- Upload mp4 to Storage so Gemini can fetch ----
        # Even if verify fails and we retry, the next attempt overwrites
        # the same path (upsert=true), so the eventual shipped clip's
        # Storage path is consistent with the final mp4.
        clip_storage_path = f"jobs/{job_id}/clips/clip_{clip.index:02d}.mp4"
        with open(local_path, "rb") as cf:
            sb.storage.from_("videos").upload(
                clip_storage_path, cf.read(),
                file_options={
                    "content-type": "video/mp4",
                    "upsert": "true",
                },
            )

        # ---- Mark verifying in DB so the dashboard shows the spinner
        #      on this specific clip. If the row doesn't exist yet
        #      (run_pipeline path inserts it later), this update is a
        #      no-op; that's fine — the row will land with default
        #      status='unchecked' until the per-row update at the end.
        try:
            sb.table("clips").update({
                "verification_status": "verifying",
                "verification_attempts": attempts,
            }).eq("job_id", job_id).eq("index", clip.index).execute()
        except Exception:
            # Non-fatal: schema might not be migrated yet, or the row
            # might not exist. Don't block the pipeline on UI sugar.
            pass

        set_status_fn(
            "verifying",
            f"Verifying {progress_label} (attempt {attempts}/{MAX_VERIFY_ATTEMPTS})",
        )

        # ---- Generate per-clip checks (Sonnet) ----
        # If we have no feedback grounding (run_pipeline path), the
        # check generator still returns reasonable baseline checks
        # from the visual_prompt itself, but it might also return
        # []; that's the "ship the clip, mark unchecked" branch.
        checks = await _generate_clip_checks(
            clip_voiceover=clip.voiceover or "",
            clip_visual_prompt=clip.visual_prompt or "",
            feedback_text=feedback_text or "",
            diagnosis=diagnosis,
            kie_api_key=kie_api_key,
            openrouter_api_key=openrouter_api_key,
        )
        last_checks = checks
        if not checks:
            # No checks → no verification possible. Ship as
            # 'unchecked' rather than blocking. Also no point
            # retrying — the next attempt would also have no
            # checks.
            print(
                f"[verify] {progress_label}: no checks generated, "
                f"shipping as unchecked"
            )
            final_status = "unchecked"
            last_verify_notes = {"checks": [], "results": [], "skipped": "no checks"}
            break

        # ---- Visual verify (Gemini via OpenRouter) ----
        if not openrouter_api_key:
            print(
                f"[verify] {progress_label}: OPENROUTER_API_KEY missing, "
                f"shipping as unchecked"
            )
            final_status = "unchecked"
            last_verify_notes = {
                "checks": checks, "results": [],
                "skipped": "no openrouter key",
            }
            break

        clip_url = _public_clip_url(clip_storage_path)
        verify_resp = await _gemini_verify_clip(
            clip_url=clip_url,
            checks=checks,
            openrouter_api_key=openrouter_api_key,
        )
        last_verify_notes = {"checks": checks, **verify_resp}

        passed = _verify_results_passed(verify_resp, checks)
        if passed:
            final_status = "verified"
            break

        # Gemini hit an outage: treat the same as out-of-budget —
        # ship the clip 'unchecked' rather than burning another
        # Seedance call on what is likely a transient OR issue.
        if verify_resp.get("error"):
            print(
                f"[verify] {progress_label}: gemini error "
                f"({verify_resp['error']}); shipping as unchecked"
            )
            final_status = "unchecked"
            break

        # Out of attempts? Ship as failed and let the user know.
        if attempts >= MAX_VERIFY_ATTEMPTS:
            failure_summary = _summarize_failed_checks(checks, verify_resp)
            print(
                f"[verify] {progress_label}: failed after "
                f"{attempts}/{MAX_VERIFY_ATTEMPTS} attempts "
                f"— {failure_summary}"
            )
            final_status = "failed"
            break

        # We have budget — augment the prompt and loop.
        addendum, voiceover_related = _build_retry_prompt_addendum(
            checks, verify_resp
        )
        clip.visual_prompt = (clip.visual_prompt or "") + addendum
        if voiceover_related:
            # Include the same addendum on the voiceover so audio-
            # related failures (mispronunciation, dropped words) get
            # a second chance, not just visual ones.
            clip.voiceover = (clip.voiceover or "") + addendum
        failure_summary = _summarize_failed_checks(checks, verify_resp)
        set_status_fn(
            "verifying",
            f"Retrying {progress_label} — gemini flagged: {failure_summary}",
        )
        print(
            f"[verify] {progress_label}: attempt {attempts} failed "
            f"({failure_summary}); regenerating with augmented prompt"
        )

    return (
        last_local_path,
        last_kie_meta,
        total_credits,
        attempts,
        final_status,
        last_verify_notes,
        last_checks,
    )


# --- Per-clip surgery prompt ---
#
# Distinct from script_generator's full ClipPlan prompt: that one builds
# a plan from scratch. This one EDITS an existing plan, mutating only
# the targeted clip. The minimum-change framing is critical — without it
# Claude tends to "improve" unrelated clips, which defeats the entire
# point of surgery (you regenerate just the clip you wanted to fix and
# pay for one Seedance call instead of all of them).
# Shared rules that BOTH regen paths (surgery + smart-regen) need to
# follow when they edit voiceover or visual_prompt fields. Without
# these, regen prompts silently bypass every rule we put in
# SYSTEM_TEMPLATE — and Yonah keeps seeing the same Jewish-visual and
# pronunciation issues across multiple regen iterations.
#
# Duplicated from SYSTEM_TEMPLATE (in src/script_generator.py).
# Future cleanup: extract a single shared rule module both paths import.
_REGEN_GROUNDING_RULES = """
WHEN YOU EDIT A VOICEOVER FIELD — phonetic rules:

Hebrew gutturals (ח, sometimes כ) must ALWAYS be rendered as "H",
NEVER "Ch". English "Ch" sounds like "church" and Seedance's TTS
reads it that way. Use H, sometimes KH for strong emphasis.

Hashem: PREFER "the Name" or "G-d" instead of writing "Hashem" in
voiceover. Seedance's TTS reliably mis-renders "Hashem" — drops the
trailing M ("Hashev", "Ha-Shey"). The phonetic "ha-SHEM" still hits
the same failure. Only write "Hashem" when cultural specificity is
non-negotiable.

English words Seedance TTS mis-pronounces — use simpler synonyms:
  cessation -> "ceasing" / "stopping" / "rest"
  embodiment -> "embodying" / "living out"
  transcendent -> "beyond words" / "beyond grasp"
  annihilation -> "ending" / "undoing"
  ineffable -> "beyond words"

WHEN YOU EDIT A VISUAL_PROMPT FIELD — Jewish ritual objects must be
expanded with concrete visual specifics, not vague nouns. Seedance's
training data is light on Jewish objects, so "Shabbat candles" gets
substituted with what it knows (a candelabra, a menorah, etc).

  Shabbat candles -> "TWO white tapered candles, both lit, in matching
    polished silver candlesticks. Place them SIDE BY SIDE on the same
    surface (the table, or a single tray on the table), with about 4
    inches of space between the two candlesticks. They are TWO
    DISTINCT objects but in ONE GROUPING — read as a pair, not items
    scattered around the room. NEVER on separate shelves, NEVER in
    different parts of the scene, NEVER on opposite ends of a table."
    Critical: NEVER a candelabra, NEVER a menorah, NEVER 5/7/9
    branches, NEVER separated onto different shelves or surfaces.

  Challah -> "Braided golden-brown egg bread loaf, six-strand braid,
    glossy crust, covered with a decorative white cloth (challah
    cover) that is plain white or simply embroidered." The cloth is
    essential.

  Kiddush cup -> "Polished silver chalice-shaped goblet on a short
    stem, holding red wine. Sits to the right of the challah."

  Shabbat table -> "Rectangular dining table with white or cream
    tablecloth. ALL of the following on the SAME table surface,
    arranged together (NOT scattered on shelves or other furniture):
    TWO lit white candles in matching silver candlesticks SIDE BY
    SIDE at one end (about 4 inches apart, NOT a candelabra),
    covered braided challah on a wooden board, silver kiddush cup
    beside the challah, bottle of red wine, place settings for the
    seated guests."

CHARACTER CONSISTENCY: every visual_prompt should include a brief
reminder anchoring the character: "Rav Eli (consistent character
reference: Pixar-style 3D, navy linen kungfu outfit, neat short
gray-streaked beard, modest knit kippah — match all other clips
exactly)." Without this reminder, Seedance regenerates clip-2's
character with drift — wrong-sized kippah, different facial
features, etc.

SPATIAL GROUPING: when objects should be TOGETHER, say so directly:
"side by side on the same surface", "all on the same table", "held
together in one hand". NEVER use vague spatial words like "offset",
"separate", "distinct" alone — Seedance reads those as "in different
parts of the scene".

DESCRIPTION OVER NOUN: "Two lit white candles in silver candlesticks"
is more reliable than "Shabbat candles". Specificity is the whole
game.
"""


SURGERY_SYSTEM_PROMPT = """You are editing one clip in an existing video plan.

You will receive:
- The full existing ClipPlan as JSON.
- The integer index of the clip the user wants regenerated.
- The user's feedback about that specific clip.

Your job is to update ONLY that clip's `voiceover` and/or `visual_prompt`
to address the feedback. Apply the feedback minimally. Do not introduce
new visual elements, do not change props the feedback doesn't mention,
do not change the clip's index, duration_s, setting_id, motion_ref_slug,
or caption_position.

For all other clips, return them EXACTLY as given — same wording, same
visuals, same everything.

Return the FULL ClipPlan JSON with all original fields (parsha, hook,
full_script, outdoor_archetype_id, captions, clips). Output JSON only,
no markdown fences, no commentary.
""" + _REGEN_GROUNDING_RULES


async def _surgery_edit_plan(
    *,
    parent_plan_dict: dict,
    target_index: int,
    feedback_text: str,
    kie_api_key: str,
    openrouter_api_key: str | None,
):
    """Ask Claude to edit one clip in the parent plan; return new ClipPlan.

    Validates that only the targeted clip changed (other clips identical
    in voiceover, visual_prompt, setting_id, duration_s) — Claude tends
    to "improve" untouched clips otherwise, which silently inflates the
    surgery's blast radius beyond what the user agreed to.
    """
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block
    from src.models import ClipPlan

    user_prompt = (
        f"Existing ClipPlan:\n{_json.dumps(parent_plan_dict, indent=2)}\n\n"
        f"Clip index to regenerate: {target_index}\n\n"
        f"User feedback on that clip:\n{feedback_text}\n\n"
        f"Return the updated full ClipPlan JSON now."
    )
    # Regen runs occasionally and quality matters more than cost, so
    # always use the most capable Claude available with an unconstrained
    # output budget.
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=SURGERY_SYSTEM_PROMPT,
        model="claude-opus-4-7",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=16000,
        log_prefix="[regen_clip]",
    )
    cleaned = _extract_json_block(raw)
    parsed = _json.loads(cleaned)
    new_plan = ClipPlan(**parsed)

    # Defense-in-depth: check that only the targeted clip differs.
    # Claude occasionally drifts on clips it wasn't asked to touch even
    # with explicit instructions; if that happens we'd silently regen
    # ONE clip but ship a plan whose other clips diverge from what's
    # already in Storage, producing a Frankenstein video. Better to
    # restore the originals than ship that.
    parent_clips_by_index = {c["index"]: c for c in parent_plan_dict["clips"]}
    new_clips_by_index = {c.index: c for c in new_plan.clips}
    if set(parent_clips_by_index.keys()) != set(new_clips_by_index.keys()):
        raise ValueError(
            f"surgery plan changed clip indices: "
            f"parent={sorted(parent_clips_by_index)} "
            f"new={sorted(new_clips_by_index)}"
        )
    for idx, parent_c in parent_clips_by_index.items():
        if idx == target_index:
            continue
        new_c = new_clips_by_index[idx]
        if (
            parent_c.get("voiceover") != new_c.voiceover
            or parent_c.get("visual_prompt") != new_c.visual_prompt
            or parent_c.get("setting_id") != new_c.setting_id
            or parent_c.get("duration_s") != new_c.duration_s
        ):
            print(
                f"[regen_clip] WARN clip {idx} drifted in surgery plan; "
                f"forcing back to parent values"
            )
            # Mutate the new_plan's clip back to the parent's wording.
            # Pydantic models are mutable by default in v2 unless frozen.
            for field in (
                "voiceover", "visual_prompt", "setting_id", "duration_s",
                "caption_position", "emotive_note", "motion_ref_slug",
                "motion_ref_url",
            ):
                if field in parent_c:
                    setattr(new_c, field, parent_c[field])
    return new_plan


# --- Smart-regen classifier prompt ---
#
# Used by regen_smart when feedback comes from the GENERAL feedback box
# (no clipId). Claude must (1) classify which clips the feedback targets
# and (2) emit an updated plan with ONLY those clips' wording changed.
# Same minimum-change framing as SURGERY_SYSTEM_PROMPT but generalized
# to N targeted clips instead of one. The wrapper validates that
# changed_clip_indices is consistent with what the plan actually changed.
SMART_REGEN_SYSTEM_PROMPT = """You are reviewing a previous video's plan and a user's feedback. Identify
which clips need changes to address the feedback, and provide an updated
plan for ONLY those clips. Leave all other clips untouched.

Return a JSON object:
{
  "changed_clip_indices": [int, ...],
  "plan": <full ClipPlan with all original clips, only the listed indices modified>
}

Rules:
- "changed_clip_indices" must be a JSON array of integers identifying
  the 0-indexed clips you actually modified.
- Modify minimally. If feedback is about a single moment (mispronunciation,
  wrong prop), change only the clip(s) covering that moment.
- If feedback is about overall pacing/tone/transitions that genuinely
  touches everything, list all clip indices and update them all.
- For each changed clip: update only the fields the feedback addresses.
  Preserve voiceover wording unless feedback is about the script.
  Preserve visual_prompt details unless feedback is about visuals.
- Do NOT change clip count, ordering, or duration_s. Those are fixed.

Output JSON only, no markdown fences, no commentary.
""" + _REGEN_GROUNDING_RULES


def _extract_feedback_section(director_notes: str | None) -> str:
    """Pull the FEEDBACK ON PREVIOUS VERSION block out of merged director_notes.

    submit-feedback.ts builds director_notes as three sections (original
    notes + previous-plan JSON + feedback). For smart-regen we want only
    the feedback text — the previous plan is passed separately as
    structured JSON so Claude can diff against it precisely.
    """
    if not director_notes:
        return ""
    marker = "FEEDBACK ON PREVIOUS VERSION"
    idx = director_notes.find(marker)
    if idx == -1:
        # No marker (legacy notes) — just return whatever we have so
        # Claude still has SOMETHING to act on.
        return director_notes.strip()
    section = director_notes[idx:]
    # Strip the marker line itself; keep the body.
    nl = section.find("\n")
    if nl == -1:
        return ""
    return section[nl + 1:].strip()


async def _smart_edit_plan(
    *,
    parent_plan_dict: dict,
    feedback_text: str,
    kie_api_key: str,
    openrouter_api_key: str | None,
):
    """Ask Claude to identify-and-edit clips. Returns (changed_indices, new_plan).

    Validation:
      - changed_clip_indices is a list of unique ints, each in range of
        the parent's clip indices.
      - new plan has identical clip count + index set as parent.
      - drift defense: any clip NOT in changed_clip_indices is forced
        back to parent values, mirroring _surgery_edit_plan.

    Empty changed_clip_indices is returned as-is so the caller can fall
    back to a full regen rather than silently doing nothing.
    """
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block
    from src.models import ClipPlan

    user_prompt = (
        f"Existing ClipPlan:\n{_json.dumps(parent_plan_dict, indent=2)}\n\n"
        f"User feedback on the video:\n{feedback_text}\n\n"
        f"Return the JSON object now (changed_clip_indices + plan)."
    )
    # Most capable model + unconstrained output budget — regen quality
    # is worth more than the marginal cost since it runs occasionally.
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=SMART_REGEN_SYSTEM_PROMPT,
        model="claude-opus-4-7",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=16000,
        log_prefix="[regen_smart]",
    )
    cleaned = _extract_json_block(raw)
    parsed = _json.loads(cleaned)

    raw_indices = parsed.get("changed_clip_indices")
    plan_dict = parsed.get("plan")
    if not isinstance(raw_indices, list) or plan_dict is None:
        raise ValueError(
            f"smart regen response missing required keys: "
            f"got keys={list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__}"
        )

    parent_clips_by_index = {c["index"]: c for c in parent_plan_dict["clips"]}
    valid_indices = set(parent_clips_by_index.keys())

    # Normalize + validate the list. Reject duplicates / out-of-range /
    # non-int entries — a sloppy index list will produce a Frankenstein
    # video later if we let it through.
    seen: set[int] = set()
    classified: list[int] = []
    for v in raw_indices:
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError(f"changed_clip_indices contains non-int: {v!r}")
        if v in seen:
            raise ValueError(f"changed_clip_indices has duplicates: {raw_indices}")
        if v not in valid_indices:
            raise ValueError(
                f"changed_clip_indices contains out-of-range index {v}; "
                f"valid={sorted(valid_indices)}"
            )
        seen.add(v)
        classified.append(v)

    new_plan = ClipPlan(**plan_dict)
    new_clips_by_index = {c.index: c for c in new_plan.clips}
    if set(parent_clips_by_index.keys()) != set(new_clips_by_index.keys()):
        raise ValueError(
            f"smart regen plan changed clip indices: "
            f"parent={sorted(parent_clips_by_index)} "
            f"new={sorted(new_clips_by_index)}"
        )

    # Drift defense: for every clip NOT in classified, force the new
    # plan back to parent values. Same fields as _surgery_edit_plan so
    # the reused mp4s remain consistent with their plan rows.
    classified_set = set(classified)
    for idx, parent_c in parent_clips_by_index.items():
        if idx in classified_set:
            continue
        new_c = new_clips_by_index[idx]
        if (
            parent_c.get("voiceover") != new_c.voiceover
            or parent_c.get("visual_prompt") != new_c.visual_prompt
            or parent_c.get("setting_id") != new_c.setting_id
            or parent_c.get("duration_s") != new_c.duration_s
        ):
            print(
                f"[regen_smart] WARN clip {idx} drifted in smart plan; "
                f"forcing back to parent values"
            )
        for field in (
            "voiceover", "visual_prompt", "setting_id", "duration_s",
            "caption_position", "emotive_note", "motion_ref_slug",
            "motion_ref_url",
        ):
            if field in parent_c:
                setattr(new_c, field, parent_c[field])

    return classified, new_plan


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def regen_smart(job_id: str) -> dict | None:
    """AI-targeted general feedback: ask Claude which clips to fix, surgery those.

    Cost shape: ~$1-3 typical (1-3 Seedance calls + cheap Claude classify)
    vs ~$5-12 a full pipeline regen would cost. The blast radius is
    bounded by Claude's classification — we still pay for ALL clips Claude
    flags, so a feedback that genuinely touches every clip ends up at
    full-regen cost (with the bonus that we still skip the script + plan
    cost since we anchored on the parent plan).

    Pre-conditions (the dashboard's submit-feedback action enforces
    these before triggering this function):
      - The job row already exists with regen_of_job_id pointing at the
        parent and director_notes carrying the merged feedback section.
      - feedback_clip_index is null (this is the no-target path).
      - The parent's clips ALL have storage_path populated (otherwise we
        can't re-stitch). If not, the dashboard falls back to full
        run_pipeline.

    Edge case: if Claude returns an empty changed_clip_indices (the
    feedback truly is whole-video and no specific clip can be pinned),
    we delegate to run_pipeline.spawn rather than crashing — better to
    pay the full-regen cost than silently produce a no-op video.
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs")
        .select("status")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status, details={"status": status, "mode": "smart_regen"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading regen target")

        # 1. Load the regen job + walk back to parent.
        regen_job = (
            sb.table("jobs")
            .select(
                "regen_of_job_id, resolution, model_tier, "
                "motion_ref_slug, kind, director_notes"
            )
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        parent_job_id = regen_job.get("regen_of_job_id")
        if parent_job_id is None:
            raise ValueError(
                f"regen_smart requires regen_of_job_id; got {parent_job_id}"
            )

        # 2. Pull the parent's plan and clips.
        parent_plan_row = (
            sb.table("clip_plans")
            .select("plan_json")
            .eq("job_id", parent_job_id)
            .order("created_at", desc=True)
            .limit(1)
            .single()
            .execute()
            .data
        )
        parent_plan_dict = parent_plan_row["plan_json"]

        parent_clips = (
            sb.table("clips")
            .select(
                "id, index, voiceover, visual_prompt, setting_id, "
                "duration_s, motion_ref_slug, motion_ref_url, "
                "storage_path"
            )
            .eq("job_id", parent_job_id)
            .order("index")
            .execute()
            .data
        ) or []
        if not parent_clips:
            raise ValueError(f"parent job {parent_job_id} has no clips")
        missing = [c["index"] for c in parent_clips if not c.get("storage_path")]
        if missing:
            raise ValueError(
                f"parent job {parent_job_id} has clips without storage_path "
                f"(indices {missing}); smart regen requires checkpointed "
                f"parents. The dashboard should have routed this to full "
                f"regen."
            )

        # 3. Extract just the feedback section from the merged
        #    director_notes — the previous-plan JSON is redundant since
        #    we pass parent_plan_dict directly to Claude.
        feedback_text = _extract_feedback_section(
            regen_job.get("director_notes")
        )
        if not feedback_text:
            raise ValueError(
                f"regen_smart job {job_id} has no parsable feedback section "
                f"in director_notes"
            )

        # 4. Ask Claude to classify + emit updated plan.
        set_status(
            "generating_plan",
            "Identifying which clips your feedback targets",
        )
        changed_indices, new_plan = asyncio.run(_smart_edit_plan(
            parent_plan_dict=parent_plan_dict,
            feedback_text=feedback_text,
            kie_api_key=os.environ["KIE_AI_API_KEY"],
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
        ))

        # 5. Empty result → fall back to full regen rather than crash.
        #    Claude couldn't pin the feedback to specific clips, so the
        #    safest answer is to redo everything.
        if not changed_indices:
            print(
                f"[regen_smart] empty changed_clip_indices for job {job_id}; "
                f"delegating to run_pipeline for full regen"
            )
            set_status(
                "queued",
                "Feedback applies broadly — running full regen",
            )
            log_event(
                sb, actor="modal", level="warn",
                event="pipeline.smart_regen.fallback_full",
                subject_type="job", subject_id=job_id,
                message="empty changed_clip_indices; delegating to full regen",
                details={"mode": "smart_regen"},
            )
            run_pipeline.spawn(job_id)
            return {"status": "delegated_to_full_regen"}

        # 6. Persist the new plan for this regen job.
        sb.table("clip_plans").insert({
            "job_id": job_id,
            "plan_json": new_plan.model_dump(mode="json"),
            "claude_cost_usd": 0.05,
        }).execute()
        log_cost(
            "clipplan", "kie", 0.05,
            f"Smart regen classify+edit (Claude via Kie, {len(changed_indices)} clips changed)",
        )

        # 7. Resolve refs once (same set for every clip).
        resolution = (regen_job.get("resolution") or "720p").lower()
        model_tier = regen_job.get("model_tier") or "standard"
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast" else "bytedance/seedance-2"
        )
        _, motion_ref_mp4_url = _load_selected_move(
            sb, regen_job.get("motion_ref_slug")
        )
        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        # 8. Regenerate the changed clips IN PARALLEL — Kie polling is
        #    mostly I/O wait, so 2-3 clips finish in roughly the same
        #    wall-clock as one. Mirror run_pipeline._generate_all.
        new_clips_by_index = {c.index: c for c in new_plan.clips}
        parent_by_index = {c["index"]: c for c in parent_clips}

        async def _regen_one(target_idx: int):
            target_clip_pydantic = new_clips_by_index[target_idx]
            local_path = work_dir / f"clip_{target_idx:02d}.mp4"
            clip_ref_video_url = (
                motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
            )
            clip_jewish_refs = _jewish_refs_for_clip(
                target_clip_pydantic, jewish_refs
            )
            # First-frame chaining: anchor regen to clip N-1's last frame
            # for visual continuity (same logic as the initial pipeline chain).
            first_frame_url = await _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=parent_job_id,
                clip_index=target_idx,
                clip_visual_prompt=target_clip_pydantic.visual_prompt or "",
                clip_setting_id=target_clip_pydantic.setting_id,
                motion_ref_slug=target_clip_pydantic.motion_ref_slug,
                kie=kie,
                work_dir=work_dir,
            )
            _, kie_meta = await generate_clip_with_meta(
                kie, target_clip_pydantic,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=local_path, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
                first_frame_url=first_frame_url,
                jewish_ref_urls=clip_jewish_refs,
            )
            credits = (
                kie_meta.get("creditsConsumed")
                or kie_meta.get("credits_consumed")
                or kie_meta.get("costCredits")
                or kie_meta.get("cost")
            )
            cost_usd = (
                float(credits) * KIE_CREDITS_TO_USD if credits is not None else 0.0
            )
            return target_idx, local_path, kie_meta, credits, cost_usd, clip_ref_video_url

        async def _regen_all():
            return await asyncio.gather(
                *(_regen_one(i) for i in changed_indices)
            )

        set_status(
            "generating_clips",
            f"Regenerating {len(changed_indices)} clip(s): "
            f"{', '.join(str(i) for i in sorted(changed_indices))}",
        )
        regen_results = asyncio.run(_regen_all())

        # 9. Insert new clip rows + upload to Storage. cost_usd is per
        #    real Kie credits → USD. regen_of_clip_id chains to parent
        #    for the version-history view.
        for target_idx, local_path, kie_meta, credits, cost_usd, clip_ref_video_url in regen_results:
            target_clip_pydantic = new_clips_by_index[target_idx]
            parent_target = parent_by_index[target_idx]
            new_clip_storage_path = (
                f"jobs/{job_id}/clips/clip_{target_idx:02d}.mp4"
            )
            with open(local_path, "rb") as cf:
                sb.storage.from_("videos").upload(
                    new_clip_storage_path, cf.read(),
                    file_options={"content-type": "video/mp4", "upsert": "true"},
                )
            sb.table("clips").insert({
                "job_id": job_id,
                "index": target_clip_pydantic.index,
                "voiceover": target_clip_pydantic.voiceover,
                "visual_prompt": target_clip_pydantic.visual_prompt,
                "setting_id": target_clip_pydantic.setting_id,
                "duration_s": target_clip_pydantic.duration_s,
                "motion_ref_slug": target_clip_pydantic.motion_ref_slug,
                "motion_ref_url": clip_ref_video_url,
                "storage_path": new_clip_storage_path,
                "mp4_path": new_clip_storage_path,
                "status": "done",
                "cost_usd": cost_usd,
                "completed_at": "now()",
                "regen_of_clip_id": parent_target["id"],
            }).execute()
            if credits is not None:
                log_cost(
                    "clip", "kie", cost_usd,
                    f"smart regen clip {target_idx} ({credits} credits)",
                )
            else:
                print(
                    f"[regen_smart] no cost field for clip {target_idx}; "
                    f"meta keys={list(kie_meta.keys())}"
                )

        # 10. Copy the unchanged clips from the parent.
        changed_set = set(changed_indices)
        for parent_c in parent_clips:
            if parent_c["index"] in changed_set:
                continue
            sb.table("clips").insert({
                "job_id": job_id,
                "index": parent_c["index"],
                "voiceover": parent_c["voiceover"],
                "visual_prompt": parent_c["visual_prompt"],
                "setting_id": parent_c["setting_id"],
                "duration_s": parent_c["duration_s"],
                "motion_ref_slug": parent_c.get("motion_ref_slug"),
                "motion_ref_url": parent_c.get("motion_ref_url"),
                "storage_path": parent_c["storage_path"],
                "mp4_path": parent_c["storage_path"],
                "status": "done",
                "cost_usd": 0,
                "completed_at": "now()",
                "regen_of_clip_id": parent_c["id"],
            }).execute()

        # 11. Stitch — new clips already on local disk; download the rest.
        set_status("stitching", "Crossfading clips into the final video")
        clip_paths_by_index: dict[int, Path] = {}
        for target_idx, local_path, _kie_meta, _credits, _cost_usd, _ref_url in regen_results:
            clip_paths_by_index[target_idx] = local_path
        for parent_c in parent_clips:
            if parent_c["index"] in changed_set:
                continue
            local = _ensure_local(sb, work_dir, parent_c["storage_path"])
            clip_paths_by_index[parent_c["index"]] = local
        ordered_paths = [
            clip_paths_by_index[i] for i in sorted(clip_paths_by_index)
        ]
        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered_paths, final_mp4)

        # 12. Upload final + thumbnail + insert videos row.
        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(thumb_local, f"jobs/{job_id}/thumb.png")
        except Exception as thumb_err:
            print(f"[thumb] skipped for smart regen job {job_id}: {type(thumb_err).__name__}: {thumb_err}")

        video_row: dict = {"job_id": job_id, "mp4_path": final_storage_path}
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        # 13. Mark done.
        set_status("done", "Smart regen video ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # 14. Video-complete webhook (parsha kind only) — same shape as
        #     run_pipeline + regen_clip.
        kind = (regen_job.get("kind") or "parsha").lower()
        if kind == "parsha":
            try:
                video_lookup = (
                    sb.table("videos")
                    .select("id")
                    .eq("job_id", job_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                )
                video_id = video_lookup[0]["id"] if video_lookup else None
                dashboard_url = os.environ.get("DASHBOARD_URL")
                webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
                if dashboard_url and webhook_secret and video_id:
                    import httpx
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                            headers={"x-pipeline-secret": webhook_secret},
                            json={"jobId": job_id, "videoId": video_id},
                        )
                        print(
                            f"[autopilot] smart regen webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                        )
                else:
                    print(
                        f"[autopilot] smart regen skipped webhook — missing config (job {job_id})"
                    )
            except Exception as hook_err:
                print(
                    f"[autopilot] smart regen webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
                )

        return {
            "status": "done",
            "changed_clip_indices": changed_indices,
        }

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        failed_stage = "unknown"
        try:
            stage_row = (
                sb.table("jobs")
                .select("status_message, status")
                .eq("id", job_id)
                .single()
                .execute()
                .data
            )
            failed_stage = (
                stage_row.get("status_message")
                or stage_row.get("status")
                or "unknown"
            )
        except Exception:
            pass

        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"smart regen {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "smart_regen",
            },
        )

        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx
                with httpx.Client(timeout=5.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-failed",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": job_id,
                            "errorMessage": f"{type(e).__name__}: {e}",
                            "stage": failed_stage,
                        },
                    )
                    print(
                        f"[fail-notify] smart regen webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                    )
            else:
                print(
                    f"[fail-notify] smart regen skipped webhook — missing config (job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[fail-notify] smart regen webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
            )

        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def regen_clip(job_id: str) -> dict | None:
    """Per-clip surgery: regenerate ONE clip, reuse the rest from Storage.

    Cost shape: ~$0.40-1.60 (one Seedance call + Claude edit) vs the
    ~$5-12 a full pipeline regen would cost.

    Pre-conditions (the dashboard's submit-feedback action enforces these
    before triggering this function):
      - The job row already exists with regen_of_job_id pointing at the
        parent and feedback_clip_index set to the integer index.
      - The parent's clips ALL have storage_path populated (otherwise we
        can't re-stitch). If not, the dashboard falls back to full
        run_pipeline.
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs")
        .select("status")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status, details={"status": status, "mode": "surgery"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading regen target")

        # 1. Load the regen job + walk back to parent.
        regen_job = (
            sb.table("jobs")
            .select(
                "regen_of_job_id, feedback_clip_index, resolution, "
                "model_tier, motion_ref_slug, kind"
            )
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        parent_job_id = regen_job.get("regen_of_job_id")
        target_index = regen_job.get("feedback_clip_index")
        if parent_job_id is None or target_index is None:
            raise ValueError(
                f"regen_clip requires regen_of_job_id and feedback_clip_index; "
                f"got parent={parent_job_id} target={target_index}"
            )

        # 2. Pull the parent's plan and clips. We need both: the plan
        # because Claude needs the full structure to edit, the clips
        # because we copy 4 of them and need their storage_path/voiceover.
        parent_plan_row = (
            sb.table("clip_plans")
            .select("plan_json")
            .eq("job_id", parent_job_id)
            .order("created_at", desc=True)
            .limit(1)
            .single()
            .execute()
            .data
        )
        parent_plan_dict = parent_plan_row["plan_json"]

        parent_clips = (
            sb.table("clips")
            .select(
                "id, index, voiceover, visual_prompt, setting_id, "
                "duration_s, motion_ref_slug, motion_ref_url, "
                "storage_path"
            )
            .eq("job_id", parent_job_id)
            .order("index")
            .execute()
            .data
        ) or []
        if not parent_clips:
            raise ValueError(f"parent job {parent_job_id} has no clips")
        # Surgery is only valid when ALL parent clips have a storage_path
        # — otherwise the re-stitch will fail when we try to download.
        # The dashboard pre-checks this and routes to full regen if it's
        # not satisfied, so reaching this branch is a logic error worth
        # surfacing rather than silently re-running everything.
        missing = [c["index"] for c in parent_clips if not c.get("storage_path")]
        if missing:
            raise ValueError(
                f"parent job {parent_job_id} has clips without storage_path "
                f"(indices {missing}); surgery requires checkpointed parents. "
                f"The dashboard should have routed this to full regen."
            )
        if target_index not in {c["index"] for c in parent_clips}:
            raise ValueError(
                f"target_index {target_index} not present in parent clips "
                f"({sorted(c['index'] for c in parent_clips)})"
            )

        # 3-4. Ask Claude to edit only the targeted clip.
        set_status("generating_plan", f"Editing clip {target_index} with your feedback")
        # The regen job's director_notes carries the merged feedback +
        # previous-plan block (built by submit-feedback.ts). For surgery
        # we just want the FEEDBACK section; the previous-plan-as-JSON
        # is redundant because we already have parent_plan_dict.
        regen_director_notes = (
            sb.table("jobs")
            .select("director_notes")
            .eq("id", job_id)
            .single()
            .execute()
            .data.get("director_notes") or ""
        )

        new_plan = asyncio.run(_surgery_edit_plan(
            parent_plan_dict=parent_plan_dict,
            target_index=target_index,
            feedback_text=regen_director_notes,
            kie_api_key=os.environ["KIE_AI_API_KEY"],
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
        ))

        # 5. Persist the new plan for this regen job.
        sb.table("clip_plans").insert({
            "job_id": job_id,
            "plan_json": new_plan.model_dump(mode="json"),
            "claude_cost_usd": 0.05,  # surgery prompt is much smaller than full
        }).execute()
        log_cost("clipplan", "kie", 0.05, "Surgery plan edit (Claude via Kie)")

        # 6. Re-run Seedance ONLY for the targeted clip.
        target_clip_pydantic = next(c for c in new_plan.clips if c.index == target_index)
        parent_target = next(c for c in parent_clips if c["index"] == target_index)
        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        # Resolve motion_ref slug → mp4 url the same way run_pipeline does.
        # The motion-ref slug is on the regen job (carried over from parent
        # at insert time); only attach it if the new clip kept the slug.
        _, motion_ref_mp4_url = _load_selected_move(
            sb, regen_job.get("motion_ref_slug")
        )

        resolution = (regen_job.get("resolution") or "720p").lower()
        model_tier = regen_job.get("model_tier") or "standard"
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast" else "bytedance/seedance-2"
        )

        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        # Surgery doesn't change the character or dojo refs — they're the
        # same physical PNGs in /root/references/. Re-upload to get fresh
        # short-lived Kie URLs.
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        set_status("generating_clips", f"Regenerating clip {target_index}")
        new_local_path = work_dir / f"clip_{target_index:02d}.mp4"
        clip_ref_video_url = (
            motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
        )
        clip_jewish_refs = _jewish_refs_for_clip(
            target_clip_pydantic, jewish_refs
        )

        # First-frame chaining: anchor regen to clip N-1's last frame for
        # visual continuity (same logic as the initial pipeline chain).
        first_frame_url: str | None = asyncio.run(
            _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=parent_job_id,
                clip_index=target_index,
                clip_visual_prompt=target_clip_pydantic.visual_prompt or "",
                clip_setting_id=target_clip_pydantic.setting_id,
                motion_ref_slug=target_clip_pydantic.motion_ref_slug,
                kie=kie,
                work_dir=work_dir,
            )
        )

        async def _regen_one():
            return await generate_clip_with_meta(
                kie, target_clip_pydantic,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=new_local_path, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
                first_frame_url=first_frame_url,
                jewish_ref_urls=clip_jewish_refs,
            )

        _, kie_meta = asyncio.run(_regen_one())
        credits = (
            kie_meta.get("creditsConsumed")
            or kie_meta.get("credits_consumed")
            or kie_meta.get("costCredits")
            or kie_meta.get("cost")
        )
        new_clip_cost_usd = (
            float(credits) * KIE_CREDITS_TO_USD if credits is not None else 0.0
        )
        if credits is not None:
            log_cost(
                "clip", "kie", new_clip_cost_usd,
                f"surgery clip {target_index} ({credits} credits)",
            )
        else:
            print(
                f"[regen_clip] no cost field for clip {target_index}; "
                f"meta keys={list(kie_meta.keys())}"
            )

        # 7. Insert the new clip row, including storage upload for the
        # newly regenerated mp4 so it's checkpointed too (a future
        # feedback round on this regen will treat THIS as the parent).
        new_clip_storage_path = f"jobs/{job_id}/clips/clip_{target_index:02d}.mp4"
        with open(new_local_path, "rb") as cf:
            sb.storage.from_("videos").upload(
                new_clip_storage_path, cf.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )
        sb.table("clips").insert({
            "job_id": job_id,
            "index": target_clip_pydantic.index,
            "voiceover": target_clip_pydantic.voiceover,
            "visual_prompt": target_clip_pydantic.visual_prompt,
            "setting_id": target_clip_pydantic.setting_id,
            "duration_s": target_clip_pydantic.duration_s,
            "motion_ref_slug": target_clip_pydantic.motion_ref_slug,
            "motion_ref_url": clip_ref_video_url,
            "storage_path": new_clip_storage_path,
            "mp4_path": new_clip_storage_path,
            "status": "done",
            "cost_usd": new_clip_cost_usd,
            "completed_at": "now()",
            "regen_of_clip_id": parent_target["id"],
        }).execute()

        # 8. Copy the other clips from the parent into this regen job.
        # cost_usd=0 because they didn't actually run this round.
        # storage_path stays the same — they literally point at the
        # parent's Storage objects, which are still there because we
        # never delete clip mp4s. regen_of_clip_id chains to the parent
        # so the version history is queryable.
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            sb.table("clips").insert({
                "job_id": job_id,
                "index": parent_c["index"],
                "voiceover": parent_c["voiceover"],
                "visual_prompt": parent_c["visual_prompt"],
                "setting_id": parent_c["setting_id"],
                "duration_s": parent_c["duration_s"],
                "motion_ref_slug": parent_c.get("motion_ref_slug"),
                "motion_ref_url": parent_c.get("motion_ref_url"),
                "storage_path": parent_c["storage_path"],
                "mp4_path": parent_c["storage_path"],
                "status": "done",
                "cost_usd": 0,
                "completed_at": "now()",
                "regen_of_clip_id": parent_c["id"],
            }).execute()

        # 9. Stitch: download the others, keep the new one local, sort
        # by clip index so the timeline stays in order regardless of
        # whichever Storage path comes back first.
        set_status("stitching", "Crossfading clips into the final video")
        clip_paths_by_index: dict[int, Path] = {target_index: new_local_path}
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            local = _ensure_local(sb, work_dir, parent_c["storage_path"])
            clip_paths_by_index[parent_c["index"]] = local
        ordered_paths = [
            clip_paths_by_index[i] for i in sorted(clip_paths_by_index)
        ]
        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered_paths, final_mp4)

        # 10. Upload final + thumbnail + insert videos row.
        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(thumb_local, f"jobs/{job_id}/thumb.png")
        except Exception as thumb_err:
            print(f"[thumb] skipped for surgery job {job_id}: {type(thumb_err).__name__}: {thumb_err}")

        video_row: dict = {"job_id": job_id, "mp4_path": final_storage_path}
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        # 11. Mark done.
        set_status("done", "Surgery video ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # 12. Fire the same video-complete webhook the full pipeline uses,
        # so the success email / autopilot fan-out logic is identical.
        # Only parsha kind, matching run_pipeline's behavior.
        kind = (regen_job.get("kind") or "parsha").lower()
        if kind == "parsha":
            try:
                video_lookup = (
                    sb.table("videos")
                    .select("id")
                    .eq("job_id", job_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                )
                video_id = video_lookup[0]["id"] if video_lookup else None
                dashboard_url = os.environ.get("DASHBOARD_URL")
                webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
                if dashboard_url and webhook_secret and video_id:
                    import httpx
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                            headers={"x-pipeline-secret": webhook_secret},
                            json={"jobId": job_id, "videoId": video_id},
                        )
                        print(
                            f"[autopilot] surgery webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                        )
                else:
                    print(
                        f"[autopilot] surgery skipped webhook — missing config (job {job_id})"
                    )
            except Exception as hook_err:
                print(
                    f"[autopilot] surgery webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
                )

        return {"status": "done", "regen_clip_index": target_index}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        failed_stage = "unknown"
        try:
            stage_row = (
                sb.table("jobs")
                .select("status_message, status")
                .eq("id", job_id)
                .single()
                .execute()
                .data
            )
            failed_stage = (
                stage_row.get("status_message")
                or stage_row.get("status")
                or "unknown"
            )
        except Exception:
            pass

        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"surgery {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "surgery",
            },
        )

        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx
                with httpx.Client(timeout=5.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-failed",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": job_id,
                            "errorMessage": f"{type(e).__name__}: {e}",
                            "stage": failed_stage,
                        },
                    )
                    print(
                        f"[fail-notify] surgery webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                    )
            else:
                print(
                    f"[fail-notify] surgery skipped webhook — missing config (job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[fail-notify] surgery webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
            )

        raise


# DEPRECATED — use regen_agent_endpoint instead. Kept deployed so any
# already-running infrastructure pointing at this URL doesn't break,
# but the dashboard no longer routes new feedback here. The 4-step
# editor agent (regen_agent) supersedes this single-call surgery flow.
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def regen_clip_endpoint(payload: dict, request: Request) -> dict:
    """Surgery-mode trigger. Auth identical to `trigger`.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-regen-clip-endpoint.modal.run

    The dashboard's submit-feedback action derives this URL from
    MODAL_WORKER_URL by string-replacing 'pipeline-trigger' with
    'pipeline-regen-clip-endpoint'.
    """
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(f"[regen_clip_endpoint] config_error job_id={job_id_for_log} reason=secret-not-set")
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[regen_clip_endpoint] auth_fail job_id={job_id_for_log} "
            f"incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    # Idempotency: same shape as trigger(). Don't double-spawn paid runs.
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(f"[regen_clip_endpoint] skip_terminal job_id={job_id} status={status}")
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[regen_clip_endpoint] skip_in_flight job_id={job_id} "
                        f"status={status} age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    regen_clip.spawn(job_id)
    return {"ok": True, "job_id": job_id, "mode": "surgery"}


# DEPRECATED — use regen_agent_endpoint instead. Kept deployed so any
# already-running infrastructure pointing at this URL doesn't break,
# but the dashboard no longer routes new feedback here. The 4-step
# editor agent (regen_agent) supersedes this single-call smart-regen
# flow.
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def regen_smart_endpoint(payload: dict, request: Request) -> dict:
    """Smart-regen trigger. Auth identical to `trigger` and `regen_clip_endpoint`.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-regen-smart-endpoint.modal.run

    The dashboard's submit-feedback action derives this URL from
    MODAL_WORKER_URL by string-replacing 'pipeline-trigger' with
    'pipeline-regen-smart-endpoint'.

    Used when general feedback (no clipId) lands on a parent whose
    clips are all checkpointed — Claude classifies which clips the
    feedback targets and regen_smart surgically regenerates only those.
    """
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(f"[regen_smart_endpoint] config_error job_id={job_id_for_log} reason=secret-not-set")
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[regen_smart_endpoint] auth_fail job_id={job_id_for_log} "
            f"incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    # Idempotency: same shape as trigger() and regen_clip_endpoint().
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(f"[regen_smart_endpoint] skip_terminal job_id={job_id} status={status}")
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[regen_smart_endpoint] skip_in_flight job_id={job_id} "
                        f"status={status} age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    regen_smart.spawn(job_id)
    return {"ok": True, "job_id": job_id, "mode": "smart_regen"}


# ====================================================================
# REGEN AGENT — 4-step editor (diagnose → plan → execute → verify)
# ====================================================================
#
# Replaces both regen_clip and regen_smart's single-Claude-call flows.
# Single-call regen was producing low-quality output: missing the same
# visual + pronunciation issues across multiple iterations because
# (a) it never saw prior feedback history (so it'd repeat mistakes the
# user already complained about) and (b) it couldn't self-verify before
# shipping.
#
# Step | Purpose                                            | Model
# -----+----------------------------------------------------+--------------
#  1   | Diagnose: feedback + history + plan + rules        | opus 4.7
#  2   | Plan: diagnosis -> field-level edits + rationale   | sonnet 4.6
#  3   | Execute: apply edits, copy unchanged verbatim      | haiku 4.5
#  4   | Verify: per-feedback-point check; loop ONCE if no  | opus 4.7
#
# After verify (or one Plan retry), proceeds to Seedance/stitch/
# finalize identical to regen_smart's post-Claude pipeline (steps
# 5-10 in the spec).

_REGEN_AGENT_DIAGNOSE_PROMPT = """You are diagnosing user feedback on a video pipeline. Your output drives the next three steps; clarity matters more than thoroughness.

You will receive:
- The user's CURRENT feedback on the latest video. THIS is the request you are responding to.
- ALL prior feedback on previous versions of the same video (chronological). This is HISTORICAL CONTEXT showing what's been tried — NOT a backlog of work items.
- The current ClipPlan (the most recent generation we shipped).
- The original director_notes provided when the video was first generated.
- (Optional) a hint that the user clicked "Fix this clip" on a specific clip — when present, weight the diagnosis toward that clip but do not ignore broader feedback.

CRITICAL: only act on points the user is raising in the CURRENT feedback. If
a prior round flagged something and the user did not re-flag it this round,
they have moved on — it's CLOSED, even if the prior fix was imperfect. Do
NOT silently re-litigate prior complaints. The user is the judge of what's
done; if they're not complaining about it now, leave it alone.

Output ONE JSON object, no markdown fences, no commentary, with this exact shape:

{
  "user_intent": "<one-paragraph plain-language summary of what the user wants fixed THIS ROUND. Quote the current feedback closely; do not invent new fixes from prior history.>",
  "affected_clip_indices": [int, ...],
  "root_causes": ["<concrete cause, e.g. 'Seedance TTS drops trailing M in Hashem'>", ...],
  "specific_fixes": ["<concrete change tied to the CURRENT feedback, e.g. 'replace ha-SHEM with the Name in clip 0 voiceover'. Do NOT include fixes for issues that are only in prior feedback.>", ...],
  "previously_flagged_issues_recurring": ["<STRICT intersection: a point that the user is raising AGAIN this round AND that they also raised in a prior round. If the current feedback doesn't mention it, leave it OUT.>", ...],
  "risks_to_watch": ["<things that might go wrong if we apply these fixes naively, including 'don't disturb anything in the prior feedback that wasn't re-flagged this round'>", ...]
}

Rules:
- Be concrete. "fix the pronunciation" is useless; "replace ha-SHEM with the Name in clip 0 voiceover" is useful.
- previously_flagged_issues_recurring is a STRICT INTERSECTION: a point only belongs there if the user is raising it in the CURRENT feedback AND raised something equivalent in prior feedback. If the user dropped it from this round's feedback, it does NOT belong in this list.
- specific_fixes should map 1:1 to points in the user_intent. Don't add fixes for issues the user didn't mention.
- Identify clip indices precisely. If feedback names a phrase, find which clip's voiceover contains it. If feedback is whole-video (pacing/tone), list every clip index.
- Output JSON only.

""" + _REGEN_GROUNDING_RULES


_REGEN_AGENT_PLAN_PROMPT = """You are turning a diagnosis into specific edits. Output a list of exactly the field changes needed. Don't write the new ClipPlan yet — just describe each edit.

You will receive:
- The diagnosis JSON from the previous step.
- The current ClipPlan.
- (Optional) verifier fixup notes from a prior attempt — when present, treat them as authoritative: the previous edit list missed something, and you must address it this time.

Output ONE JSON object, no markdown fences, no commentary:

{
  "edits": [
    {
      "clip_index": <int>,
      "field": "voiceover" | "visual_prompt",
      "old_value": "<current value verbatim from the input plan>",
      "new_value": "<the new value to write>",
      "rationale": "<one sentence explaining which feedback point or root cause this edit addresses>"
    },
    ...
  ]
}

Rules:
- One edit per field per clip. If a clip needs both voiceover and visual_prompt changed, emit two edits.
- Only the fields "voiceover" and "visual_prompt" are editable. Do NOT change setting_id, duration_s, motion_ref_slug, caption_position, or clip ordering.
- old_value MUST match the current ClipPlan exactly (copy-paste). If it doesn't, Execute will reject the edit.
- If the diagnosis's affected_clip_indices is empty AND there are no specific fixes, output {"edits": []} — Execute will pass the plan through unchanged.
- Apply ALL of the diagnosis's specific_fixes. Don't drop any.
- previously_flagged_issues_recurring is HISTORY, not a checklist. Do NOT generate edits FROM that field — it tells you "the user has complained about this before and is complaining again, so be EXTRA careful to fix it well in the specific_fixes that already cover it." Anything not in specific_fixes does not get edited.
- DO NOT edit clips or fields the diagnosis didn't flag. If the user didn't ask for a change there this round, leave it alone — even if you think a prior round's fix was imperfect.
- Output JSON only.

""" + _REGEN_GROUNDING_RULES


_REGEN_AGENT_EXECUTE_PROMPT = """You are applying a list of edits to a ClipPlan. Apply each edit exactly. Copy every other field verbatim from the input plan.

You will receive:
- The list of edits (clip_index, field, old_value, new_value, rationale).
- The current ClipPlan.

Output the FULL new ClipPlan as JSON with the SAME shape as the input (parsha, hook, full_script, outdoor_archetype_id, captions, clips). For each edit:
- Find the clip with matching clip_index.
- Replace ONLY the named field with new_value.
- Leave all other fields on that clip unchanged.

For every clip NOT mentioned in the edits, copy it verbatim from the input plan — same voiceover, same visual_prompt, same setting_id, same duration_s, same motion_ref_slug, same everything.

Do not "improve" untouched clips. Do not change clip count or ordering. Do not introduce new fields. Output JSON only, no markdown fences, no commentary.
"""


_REGEN_AGENT_VERIFY_PROMPT = """You are reviewing whether a video plan revision actually addresses the user's feedback. Be specific. If even one feedback point isn't addressed, say so.

You will receive:
- The user's CURRENT feedback.
- The prior feedback history (so you can flag any complaints that were raised before AND are still not fixed).
- The NEW ClipPlan after edits were applied.

Output ONE JSON object, no markdown fences, no commentary:

{
  "all_addressed": true | false,
  "per_feedback_point": [
    { "point": "<short paraphrase of one feedback point>", "addressed": true | false, "evidence": "<the specific change in the new plan that addresses it, OR an explanation of what's still missing>" }
  ],
  "any_repeats_from_prior_feedback": ["<prior-feedback complaint that the new plan still fails to address>", ...],
  "any_new_concerns_introduced": ["<new problem the edits introduced, e.g. broke pronunciation in a previously-fine clip>", ...],
  "fixup_notes": "<if all_addressed=false, a 1-3 sentence directive for the Plan step's retry — what specifically must change>"
}

Rules:
- Break the user's feedback into discrete points. A complaint like "pronunciation of Hashem and the candles look like a menorah" is two points.
- "addressed" must be true ONLY if the new ClipPlan contains a concrete change that fixes the point. "addressed" is false if the change is missing, partial, or applied to the wrong clip.
- If any per_feedback_point.addressed is false, all_addressed MUST be false.
- any_repeats_from_prior_feedback is the diagnostic you most care about — these are the failures the user has been complaining about across multiple regens. List them even if the current feedback didn't repeat them.
- fixup_notes is consumed by the Plan step's retry. Be specific: "clip 4's voiceover still says ha-SHEM; replace with 'the Name'". Vague notes will produce another bad retry.
- Output JSON only.
"""


_REGEN_SINGLE_CLIP_PROMPT = """You are rewriting ONE clip in a video plan based on user feedback. Output the full updated clip as JSON.

You receive:
- The current clip's full plan (voiceover, visual_prompt, setting_id, duration_s, motion_ref_slug, etc.).
- The user's feedback about this specific clip.

Output ONE JSON object (no markdown fences, no commentary) with the SAME shape as the input clip. Rules:
- Change ONLY voiceover and/or visual_prompt — whichever the feedback addresses. Both is fine if both apply.
- Copy every other field verbatim (setting_id, duration_s, motion_ref_slug, caption_position, emotive_note, motion_ref_url, index).
- Be conservative: preserve everything the feedback doesn't directly address. Don't paraphrase, don't "improve," don't add new visual elements.
- If the feedback is about pronunciation, edit voiceover with phonetic guidance (e.g. "Sha-BAHT" or "the Name (Hashem)").
- If the feedback is about the visual, edit visual_prompt with specific, concrete additions/changes.
- Output JSON only.
""" + _REGEN_GROUNDING_RULES


def _fetch_prior_feedback(sb, parent_job_id: str) -> list[dict]:
    """Walk the regen_of_job_id chain and collect ALL feedback rows for
    every video produced by every ancestor job, ordered chronologically.

    Returns a list of {"created_at": str, "clip_id": str|None,
    "text": str, "applied_to_job_id": str|None} dicts. Empty list if
    there are no ancestors with feedback (a fresh first-regen).

    Walking the chain matters because feedback lives on `videos`, not
    `jobs`: video V0 (first generation) gets feedback F0; the regen
    produces video V1; video V1 gets feedback F1; etc. To see "what
    has the user complained about in earlier rounds" we need every Fi
    on every Vi up the chain.
    """
    chain_job_ids: list[str] = []
    cursor: str | None = parent_job_id
    # Hard cap to avoid an infinite loop if the chain ever gets cyclic
    # (shouldn't happen — it's a self-FK with no logical cycle — but a
    # 64-deep regen chain is already absurd).
    for _ in range(64):
        if cursor is None:
            break
        chain_job_ids.append(cursor)
        row = (
            sb.table("jobs")
            .select("regen_of_job_id")
            .eq("id", cursor)
            .maybe_single()
            .execute()
        )
        if not row or not row.data:
            break
        cursor = row.data.get("regen_of_job_id")
    if not chain_job_ids:
        return []
    # Now find every video for every ancestor job, then pull feedback
    # in one query per chain.
    video_rows = (
        sb.table("videos")
        .select("id, job_id")
        .in_("job_id", chain_job_ids)
        .execute()
        .data
    ) or []
    if not video_rows:
        return []
    video_ids = [v["id"] for v in video_rows]
    fb_rows = (
        sb.table("feedback")
        .select("id, video_id, clip_id, text, applied_to_job_id, created_at")
        .in_("video_id", video_ids)
        .order("created_at")
        .execute()
        .data
    ) or []
    return fb_rows


def _format_prior_feedback(fb_rows: list[dict]) -> str:
    """Render prior feedback as a numbered chronological list for prompts.
    Empty input returns a single-line "(none)" sentinel so downstream
    prompts don't need to special-case the absence of history.
    """
    if not fb_rows:
        return "(none — this is the first feedback round on this video)"
    out_lines: list[str] = []
    for i, fb in enumerate(fb_rows, start=1):
        created = fb.get("created_at") or "?"
        clip_id = fb.get("clip_id")
        target = (
            f"per-clip (clip_id={clip_id})" if clip_id else "general"
        )
        text = (fb.get("text") or "").strip()
        out_lines.append(
            f"[{i}] {created} — {target}\n{text}"
        )
    return "\n\n".join(out_lines)


async def _diagnose_step(
    *,
    feedback_text: str,
    prior_feedback_text: str,
    parent_plan_dict: dict,
    director_notes: str,
    clip_id_hint: str | None,
    clip_voiceover_hint: str | None,
    kie_api_key: str,
    openrouter_api_key: str | None,
) -> dict:
    """Step 1: Diagnose. opus-4-7. Returns the structured diagnosis dict."""
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block

    hint_block = ""
    if clip_id_hint:
        anchor = (
            f' with voiceover "{clip_voiceover_hint.strip()}"'
            if clip_voiceover_hint else ""
        )
        hint_block = (
            f"\nUSER ACTION HINT: the user clicked 'Fix this clip' on the "
            f"clip{anchor} (clip_id={clip_id_hint}). Weight the diagnosis "
            f"toward that clip but address all the feedback they wrote.\n"
        )

    user_prompt = (
        f"CURRENT FEEDBACK (latest round, what the user wants fixed now):\n"
        f"{feedback_text}\n\n"
        f"PRIOR FEEDBACK HISTORY (oldest first; complaints from earlier "
        f"rounds — flag any that match the current feedback as "
        f"'previously_flagged_issues_recurring'):\n"
        f"{prior_feedback_text}\n\n"
        f"CURRENT CLIPPLAN (the version we just shipped that the user is "
        f"giving feedback on):\n"
        f"{_json.dumps(parent_plan_dict, indent=2)}\n\n"
        f"ORIGINAL DIRECTOR NOTES (what shaped the very first generation):\n"
        f"{director_notes or '(none)'}\n"
        f"{hint_block}\n"
        f"Output the diagnosis JSON now."
    )
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=_REGEN_AGENT_DIAGNOSE_PROMPT,
        model="claude-opus-4-7",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=8000,
        log_prefix="[regen_agent.diagnose]",
    )
    cleaned = _extract_json_block(raw)
    return _json.loads(cleaned)


async def _plan_step(
    *,
    diagnosis: dict,
    parent_plan_dict: dict,
    fixup_notes: str | None,
    kie_api_key: str,
    openrouter_api_key: str | None,
) -> dict:
    """Step 2: Plan. sonnet-4-6. Returns {"edits": [...]}."""
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block

    fixup_block = ""
    if fixup_notes:
        fixup_block = (
            f"\nVERIFIER FIXUP NOTES (the previous attempt missed "
            f"something — address this specifically):\n{fixup_notes}\n"
        )

    user_prompt = (
        f"DIAGNOSIS:\n{_json.dumps(diagnosis, indent=2)}\n\n"
        f"CURRENT CLIPPLAN:\n{_json.dumps(parent_plan_dict, indent=2)}\n"
        f"{fixup_block}\n"
        f"Output the edits JSON now."
    )
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=_REGEN_AGENT_PLAN_PROMPT,
        model="claude-sonnet-4-6",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=8000,
        log_prefix="[regen_agent.plan]",
    )
    cleaned = _extract_json_block(raw)
    return _json.loads(cleaned)


async def _execute_step(
    *,
    edits: list[dict],
    parent_plan_dict: dict,
    kie_api_key: str,
    openrouter_api_key: str | None,
):
    """Step 3: Execute. haiku-4-5-20251001. Returns the new ClipPlan
    (pydantic) plus drift-defense applied. Also returns the set of
    clip indices that the edits touched, for downstream filtering.
    """
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block
    from src.models import ClipPlan

    user_prompt = (
        f"EDITS TO APPLY:\n{_json.dumps(edits, indent=2)}\n\n"
        f"CURRENT CLIPPLAN:\n{_json.dumps(parent_plan_dict, indent=2)}\n\n"
        f"Output the full new ClipPlan JSON now."
    )
    # OpenRouter's model ID for Anthropic Haiku 4.5 is
    # 'anthropic/claude-haiku-4.5' (no date suffix). Pass the dashed
    # form here; claude_call's translator rewrites to OR's dotted form.
    # The earlier 'claude-haiku-4-5-20251001' literal pulled in
    # Anthropic's direct-API timestamped variant which translates to
    # 'anthropic/claude-haiku-4.5.20251001' on OR — invalid model id,
    # rejected with 400 Bad Request.
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=_REGEN_AGENT_EXECUTE_PROMPT,
        model="claude-haiku-4-5",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=16000,
        log_prefix="[regen_agent.execute]",
    )
    cleaned = _extract_json_block(raw)
    parsed = _json.loads(cleaned)
    new_plan = ClipPlan(**parsed)

    # Drift defense — same pattern as _smart_edit_plan. For any clip
    # NOT named in the edits, snap the new plan's clip back to parent
    # values. Cheaper Haiku is more prone to subtle paraphrasing on
    # untouched clips, and we'd ship a Frankenstein video if those
    # mismatched the storage_path mp4s we're about to reuse.
    edit_indices = {e.get("clip_index") for e in edits if isinstance(e.get("clip_index"), int)}
    parent_clips_by_index = {c["index"]: c for c in parent_plan_dict["clips"]}
    new_clips_by_index = {c.index: c for c in new_plan.clips}
    if set(parent_clips_by_index.keys()) != set(new_clips_by_index.keys()):
        raise ValueError(
            f"regen_agent execute changed clip indices: "
            f"parent={sorted(parent_clips_by_index)} "
            f"new={sorted(new_clips_by_index)}"
        )
    for idx, parent_c in parent_clips_by_index.items():
        if idx in edit_indices:
            continue
        new_c = new_clips_by_index[idx]
        drifted = (
            parent_c.get("voiceover") != new_c.voiceover
            or parent_c.get("visual_prompt") != new_c.visual_prompt
            or parent_c.get("setting_id") != new_c.setting_id
            or parent_c.get("duration_s") != new_c.duration_s
        )
        if drifted:
            print(
                f"[regen_agent.execute] WARN clip {idx} drifted in "
                f"executed plan; forcing back to parent values"
            )
        for field in (
            "voiceover", "visual_prompt", "setting_id", "duration_s",
            "caption_position", "emotive_note", "motion_ref_slug",
            "motion_ref_url",
        ):
            if field in parent_c:
                setattr(new_c, field, parent_c[field])
    return new_plan, sorted(edit_indices)


async def _verify_step(
    *,
    feedback_text: str,
    prior_feedback_text: str,
    new_plan_dict: dict,
    kie_api_key: str,
    openrouter_api_key: str | None,
) -> dict:
    """Step 4: Verify. opus-4-7. Returns the verification dict."""
    import json as _json
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block

    user_prompt = (
        f"CURRENT FEEDBACK (the round we are trying to satisfy):\n"
        f"{feedback_text}\n\n"
        f"PRIOR FEEDBACK HISTORY (so you can flag still-unaddressed "
        f"recurring complaints):\n{prior_feedback_text}\n\n"
        f"NEW CLIPPLAN (after edits were applied):\n"
        f"{_json.dumps(new_plan_dict, indent=2)}\n\n"
        f"Output the verification JSON now."
    )
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=_REGEN_AGENT_VERIFY_PROMPT,
        model="claude-opus-4-7",
        kie_api_key=kie_api_key,
        openrouter_api_key=openrouter_api_key,
        max_tokens=8000,
        log_prefix="[regen_agent.verify]",
    )
    cleaned = _extract_json_block(raw)
    return _json.loads(cleaned)


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def regen_agent(job_id: str) -> dict | None:
    """Editor-agent regen flow.

    Replaces both regen_clip and regen_smart. Runs the 4-step
    diagnose/plan/execute/verify chain, with one Plan retry if
    Verify rejects the first attempt. Then proceeds to Seedance,
    stitch, and finalize.

    Pre-conditions (the dashboard's submit-feedback action enforces
    these before calling regen_agent_endpoint):
      - The job row already exists with regen_of_job_id set.
      - The parent's clips ALL have storage_path populated (otherwise
        re-stitch can't pull the un-touched clips back). If not, the
        dashboard falls back to full run_pipeline.

    Falls back to run_pipeline.spawn if the agent's edit list ends up
    empty (no concrete changes to apply) — better to pay full-regen
    cost than ship an unchanged video.
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs")
        .select("status")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status,
            details={"status": status, "mode": "regen_agent"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading regen target")

        # 1. Load the regen job + walk back to parent.
        regen_job = (
            sb.table("jobs")
            .select(
                "regen_of_job_id, feedback_clip_index, resolution, "
                "model_tier, motion_ref_slug, kind, director_notes"
            )
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        parent_job_id = regen_job.get("regen_of_job_id")
        if parent_job_id is None:
            raise ValueError(
                f"regen_agent requires regen_of_job_id; got {parent_job_id}"
            )

        # 2. Pull the parent's plan + clips + ORIGINAL director_notes
        #    (walk the chain to the very first job in the regen tree —
        #    that's where the user-shaped intent lives).
        parent_plan_row = (
            sb.table("clip_plans")
            .select("plan_json")
            .eq("job_id", parent_job_id)
            .order("created_at", desc=True)
            .limit(1)
            .single()
            .execute()
            .data
        )
        parent_plan_dict = parent_plan_row["plan_json"]

        parent_clips = (
            sb.table("clips")
            .select(
                "id, index, voiceover, visual_prompt, setting_id, "
                "duration_s, motion_ref_slug, motion_ref_url, "
                "storage_path"
            )
            .eq("job_id", parent_job_id)
            .order("index")
            .execute()
            .data
        ) or []
        if not parent_clips:
            raise ValueError(f"parent job {parent_job_id} has no clips")
        missing = [c["index"] for c in parent_clips if not c.get("storage_path")]
        if missing:
            raise ValueError(
                f"parent job {parent_job_id} has clips without storage_path "
                f"(indices {missing}); regen_agent requires checkpointed "
                f"parents. The dashboard should have routed this to full "
                f"regen."
            )

        # Walk to the root job to get the original director_notes (the
        # very first generation's user intent). The parent's notes are
        # the merged (notes + plan + feedback) blob; we want the seed.
        original_director_notes = ""
        cursor: str | None = parent_job_id
        for _ in range(64):
            if cursor is None:
                break
            row = (
                sb.table("jobs")
                .select("regen_of_job_id, director_notes")
                .eq("id", cursor)
                .maybe_single()
                .execute()
            )
            if not row or not row.data:
                break
            next_cursor = row.data.get("regen_of_job_id")
            if next_cursor is None:
                # Root reached.
                original_director_notes = (
                    row.data.get("director_notes") or ""
                ).strip()
                break
            cursor = next_cursor

        # 3. Extract the current feedback text from this regen job's
        #    director_notes (built by submit-feedback.ts as merged
        #    notes + previous-plan + feedback section).
        feedback_text = _extract_feedback_section(
            regen_job.get("director_notes")
        )
        if not feedback_text:
            raise ValueError(
                f"regen_agent job {job_id} has no parsable feedback "
                f"section in director_notes"
            )

        # 4. Pull prior feedback history across the whole regen chain.
        prior_fb_rows = _fetch_prior_feedback(sb, parent_job_id)
        prior_feedback_text = _format_prior_feedback(prior_fb_rows)

        # 5. (Optional) per-clip hint — when the user clicked "Fix this
        #    clip" the dashboard sets feedback_clip_index AND can
        #    optionally pass a clip_id payload. We use feedback_clip_index
        #    as the authoritative hint anchor and pull the clip's
        #    voiceover for richer context.
        clip_id_hint: str | None = None
        clip_voiceover_hint: str | None = None
        target_index = regen_job.get("feedback_clip_index")
        if target_index is not None:
            target_clip = next(
                (c for c in parent_clips if c["index"] == target_index),
                None,
            )
            if target_clip:
                clip_id_hint = target_clip.get("id")
                clip_voiceover_hint = target_clip.get("voiceover")

        # ---- Step 1: Diagnose ---------------------------------------
        set_status(
            "generating_plan",
            "Diagnosing your feedback against prior versions",
        )
        diagnosis = asyncio.run(_diagnose_step(
            feedback_text=feedback_text,
            prior_feedback_text=prior_feedback_text,
            parent_plan_dict=parent_plan_dict,
            director_notes=original_director_notes,
            clip_id_hint=clip_id_hint,
            clip_voiceover_hint=clip_voiceover_hint,
            kie_api_key=os.environ["KIE_AI_API_KEY"],
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
        ))
        log_event(
            sb, actor="modal", level="info",
            event="regen_agent.diagnose",
            subject_type="job", subject_id=job_id,
            message="diagnosis produced",
            details={"diagnosis": diagnosis},
        )
        # Cost notional: the agent runs occasionally; record a flat
        # estimate per step rather than counting tokens. Tweak when we
        # have real Kie/OR billing visibility.
        log_cost("clipplan", "kie", 0.05, "regen_agent diagnose (Opus)")

        # ---- Step 2 + 3: Plan -> Execute (with one retry) -----------
        max_attempts = 2
        attempt = 0
        new_plan = None
        edited_indices: list[int] = []
        verification: dict = {}
        fixup_notes: str | None = None

        while attempt < max_attempts:
            attempt += 1
            set_status(
                "generating_plan",
                f"Planning edits (attempt {attempt}/{max_attempts})",
            )
            plan_result = asyncio.run(_plan_step(
                diagnosis=diagnosis,
                parent_plan_dict=parent_plan_dict,
                fixup_notes=fixup_notes,
                kie_api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
            ))
            edits = plan_result.get("edits") or []
            log_event(
                sb, actor="modal", level="info",
                event="regen_agent.plan",
                subject_type="job", subject_id=job_id,
                message=f"plan attempt {attempt}: {len(edits)} edits",
                details={"attempt": attempt, "edits": edits},
            )
            log_cost("clipplan", "kie", 0.02, f"regen_agent plan attempt {attempt} (Sonnet)")

            # Empty edits + first attempt: probably the diagnosis said
            # nothing concrete to fix. Fall back to full run_pipeline so
            # the user at least gets a fresh take rather than a no-op.
            if not edits:
                if attempt == 1:
                    print(
                        f"[regen_agent] empty edits on attempt {attempt} "
                        f"for job {job_id}; falling back to full regen"
                    )
                    set_status(
                        "queued",
                        "Feedback applies broadly — running full regen",
                    )
                    log_event(
                        sb, actor="modal", level="warn",
                        event="regen_agent.fallback_full",
                        subject_type="job", subject_id=job_id,
                        message="empty edits; delegating to full regen",
                        details={"mode": "regen_agent", "attempt": attempt},
                    )
                    run_pipeline.spawn(job_id)
                    return {"status": "delegated_to_full_regen"}
                # Empty on retry: accept the parent plan as-is —
                # better than crashing. The user gets a re-stitched
                # video with no clip changes (effectively a no-op
                # regen), which surfaces the issue rather than hiding
                # it.
                from src.models import ClipPlan
                new_plan = ClipPlan(**parent_plan_dict)
                edited_indices = []
                break

            set_status(
                "generating_plan",
                f"Applying {len(edits)} edit(s) to the plan",
            )
            new_plan, edited_indices = asyncio.run(_execute_step(
                edits=edits,
                parent_plan_dict=parent_plan_dict,
                kie_api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
            ))
            log_cost("clipplan", "kie", 0.01, f"regen_agent execute attempt {attempt} (Haiku)")

            # ---- Step 4: Verify -------------------------------------
            set_status(
                "generating_plan",
                f"Verifying the revised plan (attempt {attempt})",
            )
            verification = asyncio.run(_verify_step(
                feedback_text=feedback_text,
                prior_feedback_text=prior_feedback_text,
                new_plan_dict=new_plan.model_dump(mode="json"),
                kie_api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
            ))
            log_event(
                sb, actor="modal", level="info",
                event="regen_agent.verify",
                subject_type="job", subject_id=job_id,
                message=(
                    "verify pass" if verification.get("all_addressed")
                    else "verify reject"
                ),
                details={"attempt": attempt, "verification": verification},
            )
            log_cost("clipplan", "kie", 0.05, f"regen_agent verify attempt {attempt} (Opus)")

            if verification.get("all_addressed") is True:
                break
            # Verifier said no — capture fixup notes and loop ONCE.
            fixup_notes = (verification.get("fixup_notes") or "").strip() or None
            if attempt >= max_attempts:
                # Out of retries; accept whatever Plan produced and
                # press on. Verification details remain in events for
                # post-hoc inspection.
                print(
                    f"[regen_agent] verify still failing after "
                    f"{max_attempts} attempts; accepting current plan"
                )
                break

        if new_plan is None:
            # Defensive — loop above guarantees this is set, but type
            # checkers prefer the explicit guard.
            raise RuntimeError("regen_agent never produced a plan")

        # 6. Persist the new plan for this regen job.
        sb.table("clip_plans").insert({
            "job_id": job_id,
            "plan_json": new_plan.model_dump(mode="json"),
            "claude_cost_usd": 0.13,  # rough sum of step costs above
        }).execute()

        # 7. Resolve refs (same set for every clip).
        resolution = (regen_job.get("resolution") or "720p").lower()
        model_tier = regen_job.get("model_tier") or "standard"
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast" else "bytedance/seedance-2"
        )
        _, motion_ref_mp4_url = _load_selected_move(
            sb, regen_job.get("motion_ref_slug")
        )
        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        # 8. Regenerate the changed clips IN PARALLEL (asyncio.gather) —
        #    same shape as regen_smart's _regen_all. Each clip runs the
        #    Gemini visual-verify loop bounded at MAX_VERIFY_ATTEMPTS.
        new_clips_by_index = {c.index: c for c in new_plan.clips}
        parent_by_index = {c["index"]: c for c in parent_clips}

        async def _regen_one(target_idx: int):
            target_clip_pydantic = new_clips_by_index[target_idx]
            local_path_dest = work_dir / f"clip_{target_idx:02d}.mp4"
            clip_ref_video_url = (
                motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
            )

            # First-frame chaining: anchor regen to clip N-1's last frame
            # for visual continuity. Delegates to _resolve_regen_first_frame
            # which applies all eligibility gates (index > 0, no motion ref,
            # same setting, no new ritual keyword) and degrades gracefully.
            first_frame_url = await _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=parent_job_id,
                clip_index=target_idx,
                clip_visual_prompt=target_clip_pydantic.visual_prompt or "",
                clip_setting_id=target_clip_pydantic.setting_id,
                motion_ref_slug=target_clip_pydantic.motion_ref_slug,
                kie=kie,
                work_dir=work_dir,
            )

            # Wrap Seedance in the verify loop. Unlike run_pipeline
            # we have feedback_text + diagnosis here, so the checks
            # are concrete to what the user complained about.
            async def _seedance_for_clip(c):
                clip_jewish_refs = _jewish_refs_for_clip(c, jewish_refs)
                _p, _m = await generate_clip_with_meta(
                    kie, c,
                    character_ref_urls=char_refs,
                    dojo_ref_urls=dojo_refs,
                    dest=local_path_dest, resolution=resolution,
                    model=seedance_model,
                    reference_video_url=clip_ref_video_url,
                    first_frame_url=first_frame_url,
                    jewish_ref_urls=clip_jewish_refs,
                )
                return _p, _m

            (
                local_path,
                kie_meta,
                total_credits,
                verify_attempts,
                verify_status,
                verify_notes,
                _checks_used,
            ) = await _generate_clip_with_verify(
                clip=target_clip_pydantic,
                seedance_call=_seedance_for_clip,
                job_id=job_id,
                sb=sb,
                feedback_text=feedback_text,
                diagnosis=diagnosis,
                kie_api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                set_status_fn=set_status,
                progress_label=f"clip {target_idx}",
            )
            cost_usd = total_credits * KIE_CREDITS_TO_USD if total_credits else 0.0
            credits = total_credits if total_credits else None
            return (
                target_idx,
                local_path,
                kie_meta,
                credits,
                cost_usd,
                clip_ref_video_url,
                verify_attempts,
                verify_status,
                verify_notes,
            )

        async def _regen_all():
            return await asyncio.gather(
                *(_regen_one(i) for i in edited_indices)
            )

        if edited_indices:
            set_status(
                "generating_clips",
                f"Regenerating {len(edited_indices)} clip(s): "
                f"{', '.join(str(i) for i in sorted(edited_indices))}",
            )
            regen_results = asyncio.run(_regen_all())
        else:
            # No clips actually changed (verifier-rejected retry that
            # ended with a parent passthrough). Still run downstream
            # so the regen produces a video row — copy parent for all
            # clips and stitch.
            regen_results = []

        # 9. Insert new clip rows + record verify outcome. The mp4 was
        #    already uploaded to Storage inside _generate_clip_with_verify
        #    so Gemini could fetch it; we don't re-upload here.
        for (
            target_idx, local_path, kie_meta, credits, cost_usd,
            clip_ref_video_url, verify_attempts, verify_status,
            verify_notes,
        ) in regen_results:
            target_clip_pydantic = new_clips_by_index[target_idx]
            parent_target = parent_by_index[target_idx]
            new_clip_storage_path = (
                f"jobs/{job_id}/clips/clip_{target_idx:02d}.mp4"
            )
            sb.table("clips").insert({
                "job_id": job_id,
                "index": target_clip_pydantic.index,
                # Persist any prompt augmentation the verify loop
                # applied to this clip — the dashboard's clip plan /
                # debug tools should see the prompt that ACTUALLY
                # shipped, not the pre-retry version.
                "voiceover": target_clip_pydantic.voiceover,
                "visual_prompt": target_clip_pydantic.visual_prompt,
                "setting_id": target_clip_pydantic.setting_id,
                "duration_s": target_clip_pydantic.duration_s,
                "motion_ref_slug": target_clip_pydantic.motion_ref_slug,
                "motion_ref_url": clip_ref_video_url,
                "storage_path": new_clip_storage_path,
                "mp4_path": new_clip_storage_path,
                "status": "done",
                "cost_usd": cost_usd,
                "completed_at": "now()",
                "regen_of_clip_id": parent_target["id"],
                "verification_status": verify_status,
                "verification_attempts": verify_attempts,
                "verification_notes": verify_notes,
            }).execute()
            if credits is not None:
                log_cost(
                    "clip", "kie", cost_usd,
                    f"regen_agent clip {target_idx} "
                    f"({credits} credits, {verify_attempts} attempt(s)) "
                    f"verify={verify_status}",
                )
            else:
                print(
                    f"[regen_agent] no cost field for clip {target_idx}; "
                    f"meta keys={list(kie_meta.keys())}"
                )

        # 10. Copy unchanged clips from parent (cost_usd=0).
        edited_set = set(edited_indices)
        for parent_c in parent_clips:
            if parent_c["index"] in edited_set:
                continue
            sb.table("clips").insert({
                "job_id": job_id,
                "index": parent_c["index"],
                "voiceover": parent_c["voiceover"],
                "visual_prompt": parent_c["visual_prompt"],
                "setting_id": parent_c["setting_id"],
                "duration_s": parent_c["duration_s"],
                "motion_ref_slug": parent_c.get("motion_ref_slug"),
                "motion_ref_url": parent_c.get("motion_ref_url"),
                "storage_path": parent_c["storage_path"],
                "mp4_path": parent_c["storage_path"],
                "status": "done",
                "cost_usd": 0,
                "completed_at": "now()",
                "regen_of_clip_id": parent_c["id"],
            }).execute()

        # 11. Stitch — new clips on local disk; download the rest.
        set_status("stitching", "Crossfading clips into the final video")
        clip_paths_by_index: dict[int, Path] = {}
        for (
            target_idx, local_path, _kie_meta, _credits, _cost_usd,
            _ref_url, _v_attempts, _v_status, _v_notes,
        ) in regen_results:
            clip_paths_by_index[target_idx] = local_path
        for parent_c in parent_clips:
            if parent_c["index"] in edited_set:
                continue
            local = _ensure_local(sb, work_dir, parent_c["storage_path"])
            clip_paths_by_index[parent_c["index"]] = local
        ordered_paths = [
            clip_paths_by_index[i] for i in sorted(clip_paths_by_index)
        ]
        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered_paths, final_mp4)

        # 12. Upload final + thumbnail + insert videos row.
        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(thumb_local, f"jobs/{job_id}/thumb.png")
        except Exception as thumb_err:
            print(f"[thumb] skipped for regen_agent job {job_id}: {type(thumb_err).__name__}: {thumb_err}")

        video_row: dict = {"job_id": job_id, "mp4_path": final_storage_path}
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        # 13. Mark done.
        set_status("done", "Regen video ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # 14. Video-complete webhook (parsha kind only) — same shape as
        #     run_pipeline + regen_smart + regen_clip.
        kind = (regen_job.get("kind") or "parsha").lower()
        if kind == "parsha":
            try:
                video_lookup = (
                    sb.table("videos")
                    .select("id")
                    .eq("job_id", job_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                )
                video_id = video_lookup[0]["id"] if video_lookup else None
                dashboard_url = os.environ.get("DASHBOARD_URL")
                webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
                if dashboard_url and webhook_secret and video_id:
                    import httpx
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                            headers={"x-pipeline-secret": webhook_secret},
                            json={"jobId": job_id, "videoId": video_id},
                        )
                        print(
                            f"[autopilot] regen_agent webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                        )
                else:
                    print(
                        f"[autopilot] regen_agent skipped webhook — missing config (job {job_id})"
                    )
            except Exception as hook_err:
                print(
                    f"[autopilot] regen_agent webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
                )

        return {
            "status": "done",
            "edited_clip_indices": edited_indices,
            "verification": verification,
        }

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        failed_stage = "unknown"
        try:
            stage_row = (
                sb.table("jobs")
                .select("status_message, status")
                .eq("id", job_id)
                .single()
                .execute()
                .data
            )
            failed_stage = (
                stage_row.get("status_message")
                or stage_row.get("status")
                or "unknown"
            )
        except Exception:
            pass

        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"regen_agent {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "regen_agent",
            },
        )

        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx
                with httpx.Client(timeout=5.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-failed",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": job_id,
                            "errorMessage": f"{type(e).__name__}: {e}",
                            "stage": failed_stage,
                        },
                    )
                    print(
                        f"[fail-notify] regen_agent webhook {resp.status_code} for job {job_id}: {resp.text[:200]}"
                    )
            else:
                print(
                    f"[fail-notify] regen_agent skipped webhook — missing config (job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[fail-notify] regen_agent webhook failed for job {job_id}: {type(hook_err).__name__}: {hook_err}"
            )

        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def regen_agent_endpoint(payload: dict, request: Request) -> dict:
    """4-step editor-agent regen trigger.

    Auth identical to `trigger`, `regen_clip_endpoint`, and
    `regen_smart_endpoint`. Replaces the latter two in the dashboard's
    routing — both per-clip and general feedback now route here when
    the parent's clips are all checkpointed.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-regen-agent-endpoint.modal.run

    The dashboard's submit-feedback action derives this URL from
    MODAL_WORKER_URL by string-replacing 'pipeline-trigger' with
    'pipeline-regen-agent-endpoint'.

    Payload (POST JSON):
      { "job_id": "<uuid>", "clip_id": "<uuid|null>" }
    The optional clip_id is used as a hint in the diagnose step ("user
    clicked Fix this clip on clip with voiceover '...'"). The
    authoritative target index is on the job row (feedback_clip_index).
    """
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(f"[regen_agent_endpoint] config_error job_id={job_id_for_log} reason=secret-not-set")
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[regen_agent_endpoint] auth_fail job_id={job_id_for_log} "
            f"incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    # Idempotency: same shape as trigger() and the legacy regen
    # endpoints. Don't double-spawn paid runs on dashboard double-click
    # / network retry. In-flight jobs older than _STUCK_AFTER are
    # treated as stuck workers and CAN be re-triggered.
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(f"[regen_agent_endpoint] skip_terminal job_id={job_id} status={status}")
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[regen_agent_endpoint] skip_in_flight job_id={job_id} "
                        f"status={status} age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    regen_agent.spawn(job_id)
    return {"ok": True, "job_id": job_id, "mode": "regen_agent"}


# --- Single-clip surgery -------------------------------------------------
# Replaces regen_agent for the per-clip feedback path. The dashboard
# tells us which clip to fix — we don't ask an LLM. One Sonnet call
# rewrites the target clip's voiceover/visual_prompt given the user's
# feedback, then Seedance re-renders only that clip. Cheaper, faster,
# and scope is impossible to get wrong because there's no "scope
# decision" step.
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def regen_single_clip(job_id: str) -> dict | None:
    """Single-clip surgery with hard-clamped scope.

    Pre-conditions enforced by submit-clip-feedback.ts:
      - regen_of_job_id set
      - feedback_clip_index set (an int 0..N-1)
      - parent's clips ALL have storage_path
      - parent has a clip_plan
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event
    from src.claude_call import claude_call
    from src.script_generator import _extract_json_block
    from src.models import ClipPlan
    import json as _json

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs").select("status").eq("id", job_id)
        .maybe_single().execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status,
            details={"status": status, "mode": "regen_single_clip"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading clip to regenerate")

        regen_job = (
            sb.table("jobs").select(
                "regen_of_job_id, feedback_clip_index, resolution, "
                "model_tier, motion_ref_slug, kind, director_notes"
            ).eq("id", job_id).single().execute().data
        )
        parent_job_id = regen_job.get("regen_of_job_id")
        target_index = regen_job.get("feedback_clip_index")
        if parent_job_id is None or target_index is None:
            raise ValueError(
                f"regen_single_clip requires regen_of_job_id and "
                f"feedback_clip_index; got parent={parent_job_id} "
                f"target={target_index}"
            )

        parent_plan_row = (
            sb.table("clip_plans").select("plan_json")
            .eq("job_id", parent_job_id)
            .order("created_at", desc=True).limit(1)
            .single().execute().data
        )
        parent_plan_dict = parent_plan_row["plan_json"]

        parent_clips = (
            sb.table("clips").select(
                "id, index, voiceover, visual_prompt, setting_id, "
                "duration_s, motion_ref_slug, motion_ref_url, storage_path"
            ).eq("job_id", parent_job_id).order("index").execute().data
        ) or []
        if not parent_clips:
            raise ValueError(f"parent job {parent_job_id} has no clips")
        missing = [c["index"] for c in parent_clips if not c.get("storage_path")]
        if missing:
            raise ValueError(
                f"parent job {parent_job_id} missing storage_path "
                f"on clips {missing}; single-clip regen requires "
                f"checkpointed parent."
            )

        target_parent_clip = next(
            (c for c in parent_clips if c["index"] == target_index), None
        )
        if not target_parent_clip:
            raise ValueError(
                f"target_index {target_index} not in parent clips"
            )

        feedback_text = _extract_feedback_section(
            regen_job.get("director_notes")
        )
        if not feedback_text:
            raise ValueError(
                f"regen_single_clip job {job_id} has no parsable "
                f"feedback in director_notes"
            )

        # Single Sonnet call: rewrite the target clip.
        set_status("generating_plan", f"Rewriting clip {target_index}")
        target_clip_dict = next(
            c for c in parent_plan_dict["clips"]
            if c["index"] == target_index
        )
        rewrite_prompt = (
            f"FEEDBACK FROM USER:\n{feedback_text}\n\n"
            f"CURRENT CLIP (the one to rewrite):\n"
            f"{_json.dumps(target_clip_dict, indent=2)}\n\n"
            f"Output the full rewritten clip JSON now."
        )
        raw = asyncio.run(claude_call(
            messages=[{"role": "user", "content": rewrite_prompt}],
            system=_REGEN_SINGLE_CLIP_PROMPT,
            model="claude-sonnet-4-6",
            kie_api_key=os.environ["KIE_AI_API_KEY"],
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
            max_tokens=8000,
            log_prefix="[regen_single_clip.rewrite]",
        ))
        rewritten_clip_dict = _json.loads(_extract_json_block(raw))
        log_cost("clipplan", "kie", 0.02, "regen_single_clip rewrite (Sonnet)")

        # Build new ClipPlan: parent plan with target clip swapped.
        new_plan_dict = dict(parent_plan_dict)
        new_plan_dict["clips"] = [
            rewritten_clip_dict if c["index"] == target_index else dict(c)
            for c in parent_plan_dict["clips"]
        ]
        new_plan = ClipPlan(**new_plan_dict)
        sb.table("clip_plans").insert({
            "job_id": job_id,
            "plan_json": new_plan.model_dump(mode="json"),
            "claude_cost_usd": 0.02,
        }).execute()

        # Resolve refs.
        resolution = (regen_job.get("resolution") or "720p").lower()
        model_tier = regen_job.get("model_tier") or "standard"
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast"
            else "bytedance/seedance-2"
        )
        _, motion_ref_mp4_url = _load_selected_move(
            sb, regen_job.get("motion_ref_slug")
        )
        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        target_clip_pydantic = next(
            c for c in new_plan.clips if c.index == target_index
        )
        local_path_dest = work_dir / f"clip_{target_index:02d}.mp4"
        clip_ref_video_url = (
            motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
        )

        # First-frame chaining: anchor regen to clip N-1's last frame for
        # visual continuity. Delegates to _resolve_regen_first_frame which
        # applies all eligibility gates and degrades gracefully to None.
        first_frame_url: str | None = asyncio.run(
            _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=parent_job_id,
                clip_index=target_index,
                clip_visual_prompt=target_clip_pydantic.visual_prompt or "",
                clip_setting_id=target_clip_pydantic.setting_id,
                motion_ref_slug=target_clip_pydantic.motion_ref_slug,
                kie=kie,
                work_dir=work_dir,
            )
        )

        set_status("generating_clips", f"Regenerating clip {target_index}")
        clip_jewish_refs = _jewish_refs_for_clip(
            target_clip_pydantic, jewish_refs
        )

        async def _seedance_for_clip(c):
            return await generate_clip_with_meta(
                kie, c,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=local_path_dest, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
                first_frame_url=first_frame_url,
                jewish_ref_urls=clip_jewish_refs,
            )

        async def _render():
            return await _generate_clip_with_verify(
                clip=target_clip_pydantic,
                seedance_call=_seedance_for_clip,
                job_id=job_id,
                sb=sb,
                feedback_text=feedback_text,
                diagnosis=None,
                kie_api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                set_status_fn=set_status,
                progress_label=f"clip {target_index}",
            )

        (
            local_path,
            kie_meta,
            total_credits,
            verify_attempts,
            verify_status,
            verify_notes,
            _checks_used,
        ) = asyncio.run(_render())
        cost_usd = total_credits * KIE_CREDITS_TO_USD if total_credits else 0.0
        if total_credits:
            log_cost(
                "clip", "kie", cost_usd,
                f"regen_single_clip clip {target_index} "
                f"({total_credits} credits, {verify_attempts} attempt(s)) "
                f"verify={verify_status}",
            )

        # Upload regen'd clip mp4. Bucket is "videos" — same as
        # run_pipeline (line 774) and regen_smart (line 2345). The
        # "clips" bucket has never existed; using it here was a silent
        # bug that caused this whole code path to fail uploads.
        new_clip_storage_path = (
            f"jobs/{job_id}/clips/clip_{target_index:02d}.mp4"
        )
        with open(local_path, "rb") as f:
            sb.storage.from_("videos").upload(
                new_clip_storage_path, f.read(),
                file_options={
                    "content-type": "video/mp4",
                    "upsert": "true",
                },
            )

        # Insert clip rows: new for the regen'd clip, copy parent for the rest.
        sb.table("clips").insert({
            "job_id": job_id,
            "index": target_clip_pydantic.index,
            "voiceover": target_clip_pydantic.voiceover,
            "visual_prompt": target_clip_pydantic.visual_prompt,
            "setting_id": target_clip_pydantic.setting_id,
            "duration_s": target_clip_pydantic.duration_s,
            "motion_ref_slug": target_clip_pydantic.motion_ref_slug,
            "motion_ref_url": clip_ref_video_url,
            "storage_path": new_clip_storage_path,
            "mp4_path": new_clip_storage_path,
            "status": "done",
            "cost_usd": cost_usd,
            "completed_at": "now()",
            "regen_of_clip_id": target_parent_clip["id"],
            "verification_status": verify_status,
            "verification_attempts": verify_attempts,
            "verification_notes": verify_notes,
        }).execute()
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            sb.table("clips").insert({
                "job_id": job_id,
                "index": parent_c["index"],
                "voiceover": parent_c["voiceover"],
                "visual_prompt": parent_c["visual_prompt"],
                "setting_id": parent_c["setting_id"],
                "duration_s": parent_c["duration_s"],
                "motion_ref_slug": parent_c.get("motion_ref_slug"),
                "motion_ref_url": parent_c.get("motion_ref_url"),
                "storage_path": parent_c["storage_path"],
                "mp4_path": parent_c["storage_path"],
                "status": "done",
                "cost_usd": 0,
                "completed_at": "now()",
                "regen_of_clip_id": parent_c["id"],
            }).execute()

        # Stitch: regen'd clip on local disk, parent clips downloaded.
        set_status("stitching", "Stitching final video")
        clip_paths_by_index: dict[int, Path] = {target_index: local_path}
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            clip_paths_by_index[parent_c["index"]] = _ensure_local(
                sb, work_dir, parent_c["storage_path"]
            )
        ordered = [clip_paths_by_index[i] for i in sorted(clip_paths_by_index)]
        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered, final_mp4)

        # Upload final + thumbnail + insert videos row.
        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={
                    "content-type": "video/mp4", "upsert": "true",
                },
            )
        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(
                thumb_local, f"jobs/{job_id}/thumb.png"
            )
        except Exception as thumb_err:
            print(
                f"[thumb] regen_single_clip skipped: "
                f"{type(thumb_err).__name__}: {thumb_err}"
            )
        video_row: dict = {"job_id": job_id, "mp4_path": final_storage_path}
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        # Mark done + webhook (parsha kind only).
        set_status("done", "Regen ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()
        kind = (regen_job.get("kind") or "parsha").lower()
        if kind == "parsha":
            try:
                video_lookup = (
                    sb.table("videos").select("id")
                    .eq("job_id", job_id)
                    .order("created_at", desc=True).limit(1)
                    .execute().data
                )
                video_id = video_lookup[0]["id"] if video_lookup else None
                dashboard_url = os.environ.get("DASHBOARD_URL")
                webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
                if dashboard_url and webhook_secret and video_id:
                    import httpx
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                            headers={"x-pipeline-secret": webhook_secret},
                            json={"jobId": job_id, "videoId": video_id},
                        )
                        print(
                            f"[autopilot] regen_single_clip webhook "
                            f"{resp.status_code} for job {job_id}"
                        )
            except Exception as hook_err:
                print(
                    f"[autopilot] regen_single_clip webhook failed: "
                    f"{type(hook_err).__name__}: {hook_err}"
                )

        return {"status": "done", "clip_index": target_index}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"regen_single_clip {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "regen_single_clip",
            },
        )
        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def regen_single_clip_endpoint(payload: dict, request: Request) -> dict:
    """Single-clip surgery trigger.

    Auth + idempotency identical to regen_agent_endpoint. The dashboard's
    submit-clip-feedback action targets this endpoint when the parent
    is checkpointed.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-regen-single-clip-endpoint.modal.run

    The dashboard derives this URL from MODAL_WORKER_URL by string-
    replacing 'pipeline-trigger' with 'pipeline-regen-single-clip-endpoint'.

    Payload (POST JSON):
      { "job_id": "<uuid>" }
    The job's feedback_clip_index column carries the authoritative
    target index.
    """
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(
            f"[regen_single_clip_endpoint] config_error "
            f"job_id={job_id_for_log} reason=secret-not-set"
        )
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[regen_single_clip_endpoint] auth_fail "
            f"job_id={job_id_for_log} incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(
                f"[regen_single_clip_endpoint] skip_terminal "
                f"job_id={job_id} status={status}"
            )
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[regen_single_clip_endpoint] skip_in_flight "
                        f"job_id={job_id} status={status} "
                        f"age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    regen_single_clip.spawn(job_id)
    return {"ok": True, "job_id": job_id, "mode": "regen_single_clip"}


# --- Plan-only job (new for video-page redesign Phase 2) ------------
# Generates the clip_plan + stub clips rows, then exits as 'done' so
# the operator can review and assign per-clip Tai Chi moves before
# paying for clip rendering. No Seedance calls, no stitch.
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def plan_only_job(job_id: str) -> dict | None:
    """Generate the clip plan and stub clips rows for a plan-only job.

    Status transitions: queued → generating_plan → done.
    No clip rendering, no stitching. The dashboard's Phase 2 UI binds
    to the clips rows (voiceover / visual_prompt edits, motion-ref
    picker, per-card Generate button) and then triggers a clips-only
    job when the operator is ready to render.

    Pre-conditions (set by trigger-plan-only.ts before calling trigger):
      - job row exists with kind='plan-only', status='queued'
      - parsha_id + script_id both set on the job
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.script_generator import transform_draft_to_clip_plan
    from src.models import ClipPlan
    from src.events import log_event

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs").select("status").eq("id", job_id)
        .maybe_single().execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status,
            details={"status": status, "mode": "plan_only"},
        )

    try:
        set_status("generating_plan", "Claude is writing the clip plan")

        job = (
            sb.table("jobs")
            .select("parsha_id, script_id, motion_ref_slug, director_notes")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        parsha_id = job["parsha_id"]
        script_id = job["script_id"]

        parsha = (
            sb.table("parshiot").select("name, book")
            .eq("id", parsha_id).single().execute().data
        )
        script = (
            sb.table("scripts").select("option, title, style_note, draft_text")
            .eq("id", script_id).single().execute().data
        )

        selected_move, _ = _load_selected_move(sb, job.get("motion_ref_slug"))

        # Resume short-circuit: if a prior attempt already wrote a
        # clip_plan for this job_id, reuse it rather than paying Claude
        # again. Mirrors run_pipeline's resume logic.
        existing_plan_row = (
            sb.table("clip_plans")
            .select("plan_json")
            .eq("job_id", job_id)
            .order("created_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if existing_plan_row and existing_plan_row.data:
            print(
                f"[plan_only_job] reusing clip_plan for job {job_id} — "
                "skipping transform_draft_to_clip_plan"
            )
            plan = ClipPlan(**existing_plan_row.data["plan_json"])
        else:
            plan = asyncio.run(transform_draft_to_clip_plan(
                parsha_name=parsha["name"],
                book=parsha["book"],
                option=script["option"],
                style_note=script["style_note"] or "",
                title=script["title"],
                draft=script["draft_text"],
                api_key=os.environ["KIE_AI_API_KEY"],
                openrouter_api_key=os.environ.get("OPENROUTER_API_KEY"),
                selected_move=selected_move,
                director_notes=job.get("director_notes"),
            ))
            sb.table("clip_plans").insert({
                "job_id": job_id,
                "plan_json": plan.model_dump(mode="json"),
                "claude_cost_usd": 0.10,
            }).execute()

        # Insert one clips row per planned clip. motion_ref_slug is
        # intentionally NULL — spec §6.5 says the AI does NOT suggest
        # moves; the operator picks per-clip in Phase 2.
        # On resume the clips rows may already exist; upsert on
        # (job_id, index) so a retry doesn't double-insert.
        clip_rows = [
            {
                "job_id": job_id,
                "index": c.index,
                "voiceover": c.voiceover,
                "visual_prompt": c.visual_prompt,
                "setting_id": c.setting_id,
                "duration_s": c.duration_s,
                "motion_ref_slug": None,   # operator assigns in Phase 2
                "status": "pending",
            }
            for c in plan.clips
        ]
        if clip_rows:
            sb.table("clips").upsert(
                clip_rows, on_conflict="job_id,index"
            ).execute()

        set_status("done", "Plan ready for review")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        return {"status": "done", "clip_count": len(plan.clips)}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"plan_only_job {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "plan_only",
            },
        )
        raise


# --- Clips-only job (new for video-page redesign Phase 3) -----------
# Renders clips for an existing clip_plan and stitches the final video.
# clip_indexes=None renders all clips; a non-empty list renders only
# the specified indexes (single-clip or subset re-render from Phase 3).
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def clips_only_job(job_id: str) -> dict | None:
    """Render clips for an existing plan then stitch the final video.

    Status transitions: queued → generating_clips → stitching → done.

    Per-clip motion-ref resolution (spec §6.5, §11.7):
      clips.motion_ref_slug for each clip (operator's per-clip pick)
      → scripts.motion_ref_slug on the parent plan's script (legacy)
      → None (no motion reference passed to Seedance)

    Pre-conditions (set by trigger-clips.ts before calling trigger):
      - job row exists with kind='clips-only', status='queued'
      - regen_of_job_id points at the plan-only job that owns the plan
      - the Modal payload carries clip_plan_id + optional clip_indexes
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event
    from src.models import Clip

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs").select("status").eq("id", job_id)
        .maybe_single().execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status,
            details={"status": status, "mode": "clips_only"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        # Load this job's metadata — regen_of_job_id is the plan-only
        # job that owns the clip_plan. clip_plan_id and clip_indexes are
        # stored in the job's status_message (piggyback) or we fall back
        # to reading from the payload stored in status_message JSON. In
        # practice, the trigger() dispatch below reads these from the HTTP
        # payload and stores them onto the job row via the new
        # plan_clip_id + clip_indexes columns (to be added when the
        # dashboard migration ships). For now, we resolve via
        # regen_of_job_id → clip_plans.
        this_job = (
            sb.table("jobs")
            .select(
                "regen_of_job_id, resolution, model_tier, "
                "clip_plan_id, clip_indexes"
            )
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        plan_job_id = this_job.get("regen_of_job_id")

        # Resolve clip_plan_id: prefer the column (set by trigger()),
        # fall back to the most recent plan for the parent job.
        clip_plan_id = this_job.get("clip_plan_id")
        if clip_plan_id:
            plan_row = (
                sb.table("clip_plans")
                .select("id, plan_json, job_id")
                .eq("id", clip_plan_id)
                .single()
                .execute()
                .data
            )
        else:
            plan_row = (
                sb.table("clip_plans")
                .select("id, plan_json, job_id")
                .eq("job_id", plan_job_id)
                .order("created_at", desc=True)
                .limit(1)
                .single()
                .execute()
                .data
            )
        clip_plan_id = plan_row["id"]
        plan_owner_job_id = plan_row["job_id"]

        # Resolve clip_indexes: prefer the column (supports subset
        # renders), fall back to None (= all clips).
        clip_indexes: list[int] | None = this_job.get("clip_indexes")

        # Load the plan and parent job settings.
        from src.models import ClipPlan as _ClipPlan
        plan = _ClipPlan(**plan_row["plan_json"])
        parent_job = (
            sb.table("jobs")
            .select("parsha_id, script_id, resolution, model_tier")
            .eq("id", plan_owner_job_id)
            .single()
            .execute()
            .data
        )

        # Legacy motion fallback: scripts.motion_ref_slug from the
        # original plan job's script. Used when clips.motion_ref_slug
        # is NULL (operator hasn't picked a move for this clip).
        script_motion: str | None = None
        if parent_job.get("script_id"):
            script_row = (
                sb.table("scripts")
                .select("motion_ref_slug")
                .eq("id", parent_job["script_id"])
                .maybe_single()
                .execute()
                .data
            ) or {}
            script_motion = script_row.get("motion_ref_slug")

        resolution = (
            (this_job.get("resolution") or parent_job.get("resolution") or "720p")
            .lower()
        )
        model_tier = (
            this_job.get("model_tier") or parent_job.get("model_tier") or "standard"
        )
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast"
            else "bytedance/seedance-2"
        )

        # Determine which clips to render.
        all_planned = plan.clips
        if clip_indexes is not None:
            target_planned = [c for c in all_planned if c.index in clip_indexes]
        else:
            target_planned = list(all_planned)

        if not target_planned:
            raise ValueError(
                f"clips_only_job: no clips matched clip_indexes={clip_indexes} "
                f"in plan with {len(all_planned)} clips"
            )

        # Per-clip motion resolution: read clips.motion_ref_slug for
        # each target clip (operator's per-clip pick from Phase 2 UI),
        # fall back to scripts.motion_ref_slug if NULL.
        target_indexes = [c.index for c in target_planned]
        clip_db_rows = (
            sb.table("clips")
            .select("index, motion_ref_slug")
            .eq("job_id", plan_owner_job_id)
            .in_("index", target_indexes)
            .execute()
            .data
        ) or []
        per_clip_motion: dict[int, str | None] = {
            r["index"]: (r.get("motion_ref_slug") or script_motion)
            for r in clip_db_rows
        }
        # Clips not yet in DB (edge case): fall back to script motion.
        for c in target_planned:
            if c.index not in per_clip_motion:
                per_clip_motion[c.index] = script_motion

        set_status("generating_clips", f"Generating 0 of {len(target_planned)} clips")

        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        completed_count = 0
        clip_paths_by_index: dict[int, Path] = {}

        async def _render_one(c):
            nonlocal completed_count
            slug = per_clip_motion.get(c.index)
            _, motion_url = _load_selected_move(sb, slug)
            dest = work_dir / f"clip_{c.index:02d}.mp4"
            clip_jewish_refs = _jewish_refs_for_clip(c, jewish_refs)
            # First-frame chaining: anchor each clip render to the previous
            # clip's last frame for visual continuity, same as the initial
            # pipeline. For clips_only, the "parent" clips live on
            # plan_owner_job_id (the plan-only job that owns the clip_plan).
            first_frame_url = await _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=plan_owner_job_id,
                clip_index=c.index,
                clip_visual_prompt=c.visual_prompt or "",
                clip_setting_id=c.setting_id,
                motion_ref_slug=slug,
                kie=kie,
                work_dir=work_dir,
            )
            _, kie_meta = await generate_clip_with_meta(
                kie, c,
                character_ref_urls=char_refs,
                dojo_ref_urls=dojo_refs,
                dest=dest,
                resolution=resolution,
                model=seedance_model,
                reference_video_url=motion_url,
                first_frame_url=first_frame_url,
                jewish_ref_urls=clip_jewish_refs,
            )
            credits = (
                kie_meta.get("credits_consumed")
                or kie_meta.get("creditsConsumed")
                or kie_meta.get("costCredits")
                or 0
            )
            cost_usd = float(credits) * KIE_CREDITS_TO_USD if credits else 0.0

            clip_storage_path = (
                f"jobs/{job_id}/clips/clip_{c.index:02d}.mp4"
            )
            with open(dest, "rb") as f:
                sb.storage.from_("videos").upload(
                    clip_storage_path, f.read(),
                    file_options={
                        "content-type": "video/mp4", "upsert": "true",
                    },
                )
            # Upsert the clip row so this job owns a full clips set.
            sb.table("clips").upsert({
                "job_id": job_id,
                "index": c.index,
                "voiceover": c.voiceover,
                "visual_prompt": c.visual_prompt,
                "setting_id": c.setting_id,
                "duration_s": c.duration_s,
                "motion_ref_slug": slug,
                "motion_ref_url": motion_url,
                "storage_path": clip_storage_path,
                "mp4_path": clip_storage_path,
                "status": "done",
                "cost_usd": cost_usd,
                "completed_at": "now()",
            }, on_conflict="job_id,index").execute()

            if cost_usd:
                log_cost(
                    "clip", "kie", cost_usd,
                    f"clips_only clip {c.index} ({credits} credits)",
                )

            completed_count += 1
            set_status(
                "generating_clips",
                f"Generating {completed_count} of {len(target_planned)} clips",
            )
            return c.index, dest

        results = asyncio.run(
            asyncio.gather(*(_render_one(c) for c in target_planned))
        )
        for idx, path in results:
            clip_paths_by_index[idx] = path

        # For the stitch we need ALL clips in the plan, not just the
        # rendered subset. Download any that belong to the plan-owner
        # job but weren't re-rendered this run.
        for c in all_planned:
            if c.index in clip_paths_by_index:
                continue
            existing = (
                sb.table("clips")
                .select("storage_path")
                .eq("job_id", plan_owner_job_id)
                .eq("index", c.index)
                .maybe_single()
                .execute()
                .data
            ) or {}
            sp = existing.get("storage_path")
            if sp:
                clip_paths_by_index[c.index] = _ensure_local(
                    sb, work_dir, sp
                )
                # Copy the plan-owner clip row into this job's clips set
                # so the job has a complete clip set for future regens.
                parent_clip_full = (
                    sb.table("clips")
                    .select(
                        "voiceover, visual_prompt, setting_id, duration_s, "
                        "motion_ref_slug, motion_ref_url, cost_usd"
                    )
                    .eq("job_id", plan_owner_job_id)
                    .eq("index", c.index)
                    .maybe_single()
                    .execute()
                    .data
                ) or {}
                sb.table("clips").upsert({
                    "job_id": job_id,
                    "index": c.index,
                    "voiceover": parent_clip_full.get("voiceover", c.voiceover),
                    "visual_prompt": parent_clip_full.get("visual_prompt", c.visual_prompt),
                    "setting_id": parent_clip_full.get("setting_id", c.setting_id),
                    "duration_s": parent_clip_full.get("duration_s", c.duration_s),
                    "motion_ref_slug": parent_clip_full.get("motion_ref_slug"),
                    "motion_ref_url": parent_clip_full.get("motion_ref_url"),
                    "storage_path": sp,
                    "mp4_path": sp,
                    "status": "done",
                    "cost_usd": parent_clip_full.get("cost_usd", 0),
                }, on_conflict="job_id,index").execute()

        # Stitch all clips in plan order.
        set_status("stitching", "Stitching final video")
        ordered_paths = [
            clip_paths_by_index[c.index]
            for c in sorted(all_planned, key=lambda x: x.index)
            if c.index in clip_paths_by_index
        ]
        if not ordered_paths:
            raise ValueError("clips_only_job: no clip paths resolved for stitch")

        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered_paths, final_mp4)

        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(
                thumb_local, f"jobs/{job_id}/thumb.png"
            )
        except Exception as thumb_err:
            print(
                f"[thumb] clips_only_job skipped: "
                f"{type(thumb_err).__name__}: {thumb_err}"
            )

        # spoken_script from the stitched clips.
        spoken_clips = [
            {"index": c.index, "voiceover": c.voiceover}
            for c in sorted(all_planned, key=lambda x: x.index)
        ]
        spoken_script = _build_spoken_script(spoken_clips)

        video_row: dict = {
            "job_id": job_id,
            "mp4_path": final_storage_path,
            "spoken_script": spoken_script,
        }
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        set_status("done", "Video ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # Success webhook (same endpoint as run_pipeline).
        try:
            video_lookup = (
                sb.table("videos").select("id")
                .eq("job_id", job_id)
                .order("created_at", desc=True).limit(1)
                .execute().data
            )
            video_id = video_lookup[0]["id"] if video_lookup else None
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret and video_id:
                import httpx
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={"jobId": job_id, "videoId": video_id},
                    )
                    print(
                        f"[autopilot] clips_only_job webhook "
                        f"{resp.status_code} for job {job_id}"
                    )
        except Exception as hook_err:
            print(
                f"[autopilot] clips_only_job webhook failed: "
                f"{type(hook_err).__name__}: {hook_err}"
            )

        return {"status": "done", "clip_count": len(target_planned)}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=job_id,
            message=f"clips_only_job {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "clips_only",
            },
        )
        raise


# --- Regen from edited text (no AI) ---------------------------------
# Sibling of regen_single_clip with no Claude rewrite. The user has
# already typed the exact voiceover/visual_prompt they want into the
# dashboard, which writes them onto the PARENT's clips row via
# update-clip-text.ts. This function reads those strings verbatim and
# sends them straight to Seedance.
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
def regen_clip_from_text(job_id: str) -> dict | None:
    """No-AI single-clip re-render. Reads the clip's stored voiceover
    and visual_prompt verbatim from the PARENT job's clips row and
    sends them to Seedance. No Claude rewrite, no diagnose, no verify.

    Pre-conditions enforced by regen-clip-from-text.ts:
      - regen job has regen_of_job_id set
      - regen job has feedback_clip_index set
      - parent has all clips checkpointed (storage_path populated)
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.video_generator import generate_clip_with_meta
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event
    from src.models import Clip

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs").select("status").eq("id", job_id)
        .maybe_single().execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=job_id,
            message=message or status,
            details={"status": status, "mode": "regen_clip_from_text"},
        )

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        # matches regen_single_clip's status sequence — would benefit from a clearer name across both
        set_status("loading_parsha", "Reading edited clip text")
        regen_job = (
            sb.table("jobs").select(
                "regen_of_job_id, feedback_clip_index, resolution, "
                "model_tier, motion_ref_slug, kind"
            ).eq("id", job_id).single().execute().data
        )
        parent_job_id = regen_job.get("regen_of_job_id")
        target_index = regen_job.get("feedback_clip_index")
        if parent_job_id is None or target_index is None:
            raise ValueError(
                f"regen_clip_from_text requires regen_of_job_id and "
                f"feedback_clip_index; got parent={parent_job_id} "
                f"target={target_index}"
            )

        # The clip text/visual the user just saved is on the PARENT
        # clip row (update-clip-text.ts writes there). Re-render uses
        # those exact strings — no Claude rewrite.
        parent_clips = (
            sb.table("clips").select(
                "id, index, voiceover, visual_prompt, setting_id, "
                "duration_s, motion_ref_slug, motion_ref_url, storage_path"
            ).eq("job_id", parent_job_id).order("index").execute().data
        ) or []
        # Compose case: a compose job owns a videos row but no clip rows
        # of its own. Its videos row carries composed_from_clip_ids — the
        # exact per-slot clip UUIDs the user picked when composing. We
        # MUST resolve to those rather than walking to a single source
        # job, because the compose's slots can come from many different
        # source jobs (regens, originals, prior composes). Walking to
        # one source job and copying its full clip set was the bug that
        # made regen-on-compose silently swap OTHER clips back to the
        # source job's versions ("completely different clips throughout"
        # after regenerating just one).
        if not parent_clips:
            parent_video = (
                sb.table("videos")
                .select("composed_from_clip_ids")
                .eq("job_id", parent_job_id)
                .maybe_single().execute()
            )
            composed_ids = (
                (parent_video.data or {}).get("composed_from_clip_ids")
                if parent_video else None
            ) or []
            if composed_ids:
                rows = (
                    sb.table("clips").select(
                        "id, index, voiceover, visual_prompt, setting_id, "
                        "duration_s, motion_ref_slug, motion_ref_url, storage_path"
                    ).in_("id", composed_ids).execute().data
                ) or []
                clips_by_id = {r["id"]: r for r in rows}
                synthetic: list[dict] = []
                for slot_idx, clip_id in enumerate(composed_ids):
                    if clip_id in clips_by_id:
                        c = dict(clips_by_id[clip_id])
                        c["index"] = slot_idx
                        synthetic.append(c)
                parent_clips = synthetic
        if not parent_clips:
            raise ValueError(f"parent job {parent_job_id} has no clips")
        missing = [c["index"] for c in parent_clips if not c.get("storage_path")]
        if missing:
            raise ValueError(
                f"parent job {parent_job_id} missing storage_path "
                f"on clips {missing}; regen_clip_from_text requires "
                f"checkpointed parent."
            )

        target_parent_clip = next(
            (c for c in parent_clips if c["index"] == target_index), None
        )
        if not target_parent_clip:
            raise ValueError(
                f"clip index {target_index} not found on parent {parent_job_id}"
            )

        # Auto-extend duration to fit the (possibly-edited) voiceover.
        #
        # The WPS cap (3.0 wps hard / 2.6 wps target) is enforced by the
        # script-generator prompt during initial generation, but NOT on
        # per-clip re-renders. So when Yonah edits a clip's voiceover
        # to add more words without touching duration_s, the regen used
        # to dispatch with the original duration_s — and Seedance had
        # to cram the speech to fit. On 2026-05-14 he hit this on a
        # Bamidbar clip where 42 words went into a 10s render = 4.2 wps,
        # well above the 3.0 cap; the result was rushed speech that no
        # amount of post-processing could fully rescue.
        #
        # Fix: count words, compute the minimum duration that keeps WPS
        # at our 2.6 target, and bump duration_s up if needed. Never
        # shrink (a slow-paced clip stays slow-paced). Cap at the 15s
        # Seedance hard limit; if even that's not enough we log a
        # warning and let Seedance render at 15s — the user can see
        # the message and trim the text on the next pass.
        WPS_HARD_CAP = 3.0
        TARGET_WPS = 2.6
        MAX_DURATION_S = 15
        MIN_DURATION_S = 4
        voiceover_text = target_parent_clip["voiceover"] or ""
        word_count = len(voiceover_text.split())
        current_duration = int(target_parent_clip["duration_s"] or 0)
        current_wps = (
            word_count / current_duration if current_duration > 0 else float("inf")
        )
        if current_wps > WPS_HARD_CAP and word_count > 0:
            import math as _math
            needed = _math.ceil(word_count / TARGET_WPS)
            new_duration = min(needed, MAX_DURATION_S)
            new_duration = max(new_duration, current_duration, MIN_DURATION_S)
            if needed > MAX_DURATION_S:
                print(
                    f"[regen_clip_from_text] clip {target_index}: voiceover "
                    f"is {word_count} words; needs ~{needed}s at target "
                    f"{TARGET_WPS} wps but capped at {MAX_DURATION_S}s — "
                    f"resulting WPS will be {word_count / MAX_DURATION_S:.2f} "
                    f"(still above {WPS_HARD_CAP} cap). Consider trimming "
                    f"the voiceover."
                )
            print(
                f"[regen_clip_from_text] clip {target_index}: auto-extended "
                f"duration {current_duration}s → {new_duration}s for "
                f"{word_count} words (was {current_wps:.2f} wps, now "
                f"{word_count / new_duration:.2f} wps)"
            )
            effective_duration = new_duration
        else:
            effective_duration = current_duration

        # Per-clip motion-ref resolution (EXECUTION-NOTES + spec §11.7):
        #   1. clips.motion_ref_slug for THIS clip (operator's per-clip pick
        #      in the Phase 2/3 UI — the most specific and freshest value).
        #   2. scripts.motion_ref_slug from the job chain (legacy per-script
        #      fallback for plans created before the redesign).
        #   3. None — no motion reference passed to Seedance.
        # We resolve to a URL here so _load_selected_move is called exactly
        # once and the URL is available to both the Clip model and the chain
        # decision below.
        _per_clip_slug = target_parent_clip.get("motion_ref_slug")
        if not _per_clip_slug:
            # Fall back to the script-level motion slug via the job chain.
            _parent_job_row = (
                sb.table("jobs")
                .select("script_id, regen_of_job_id")
                .eq("id", parent_job_id)
                .maybe_single()
                .execute()
                .data
            ) or {}
            _script_id = _parent_job_row.get("script_id")
            if not _script_id:
                # Walk one level up (regen job → original job).
                _grandparent_id = _parent_job_row.get("regen_of_job_id")
                if _grandparent_id:
                    _gp_row = (
                        sb.table("jobs")
                        .select("script_id")
                        .eq("id", _grandparent_id)
                        .maybe_single()
                        .execute()
                        .data
                    ) or {}
                    _script_id = _gp_row.get("script_id")
            if _script_id:
                _script_row = (
                    sb.table("scripts")
                    .select("motion_ref_slug")
                    .eq("id", _script_id)
                    .maybe_single()
                    .execute()
                    .data
                ) or {}
                _per_clip_slug = _script_row.get("motion_ref_slug")
        _resolved_motion_slug = _per_clip_slug  # None if both sources are NULL
        _, _resolved_motion_url = _load_selected_move(sb, _resolved_motion_slug)

        clip = Clip(
            index=target_index,
            voiceover=voiceover_text,
            visual_prompt=target_parent_clip["visual_prompt"],
            duration_s=effective_duration,
            setting_id=target_parent_clip["setting_id"],
            motion_ref_slug=_resolved_motion_slug,
        )

        # Resolve refs.
        resolution = (regen_job.get("resolution") or "720p").lower()
        model_tier = regen_job.get("model_tier") or "standard"
        # Helper swap: _seedance_model_for_tier doesn't exist in
        # modal_app.py — mirror the inline pattern that
        # regen_single_clip uses around line 4581.
        seedance_model = (
            "bytedance/seedance-2-fast" if model_tier == "fast"
            else "bytedance/seedance-2"
        )
        kie = KieClient(api_key=os.environ["KIE_AI_API_KEY"])
        char_refs = asyncio.run(_upload_dir(kie, Path("/root/references"), "char"))
        dojo_refs = asyncio.run(_upload_dir(kie, Path("/root/references/dojo"), "dojo"))
        jewish_refs = asyncio.run(_upload_jewish_refs(kie))
        clip_jewish_refs = _jewish_refs_for_clip(clip, jewish_refs)

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)
        local_path_dest = work_dir / f"clip_{target_index:02d}.mp4"
        clip_ref_video_url = _resolved_motion_url

        # First-frame chaining: anchor regen to clip N-1's last frame for
        # visual continuity. Delegates to _resolve_regen_first_frame which
        # applies all eligibility gates and degrades gracefully to None.
        first_frame_url: str | None = asyncio.run(
            _resolve_regen_first_frame(
                sb=sb,
                parent_job_id=parent_job_id,
                clip_index=target_index,
                clip_visual_prompt=clip.visual_prompt or "",
                clip_setting_id=clip.setting_id,
                motion_ref_slug=_resolved_motion_slug,
                kie=kie,
                work_dir=work_dir,
            )
        )

        set_status("generating_clips", f"Re-rendering clip {target_index}")
        local_path, kie_meta = asyncio.run(generate_clip_with_meta(
            kie, clip,
            character_ref_urls=char_refs,
            dojo_ref_urls=dojo_refs,
            dest=local_path_dest,
            resolution=resolution,
            model=seedance_model,
            reference_video_url=clip_ref_video_url,
            first_frame_url=first_frame_url,
            jewish_ref_urls=clip_jewish_refs,
        ))

        # Cost accounting from Kie meta.
        total_credits = 0
        try:
            total_credits = int(
                kie_meta.get("credits_consumed")
                or kie_meta.get("costCredits")
                or 0
            )
        except (TypeError, ValueError):
            total_credits = 0
        cost_usd = total_credits * KIE_CREDITS_TO_USD if total_credits else 0.0
        if total_credits:
            log_cost(
                "clip", "kie", cost_usd,
                f"regen_clip_from_text clip {target_index} "
                f"({total_credits} credits)",
            )

        # Upload regen'd clip mp4 + insert clip rows. Mirrors
        # regen_single_clip: new row for the regen'd clip, copy parent
        # rows for the rest so this regen job has a complete clips
        # set. Helper swap: _restitch_parent doesn't exist; we follow
        # the existing inline stitch pattern instead, producing a new
        # videos row for THIS regen job (same as regen_single_clip).
        # Bucket is "videos" — same as run_pipeline / regen_smart.
        # (regen_single_clip used to write to a non-existent "clips"
        # bucket; that was a silent bug fixed in the same commit.)
        new_clip_storage_path = (
            f"jobs/{job_id}/clips/clip_{target_index:02d}.mp4"
        )
        with open(local_path, "rb") as f:
            sb.storage.from_("videos").upload(
                new_clip_storage_path, f.read(),
                file_options={
                    "content-type": "video/mp4",
                    "upsert": "true",
                },
            )

        new_clip = sb.table("clips").insert({
            "job_id": job_id,
            "index": clip.index,
            "voiceover": clip.voiceover,
            "visual_prompt": clip.visual_prompt,
            "setting_id": clip.setting_id,
            "duration_s": clip.duration_s,
            "motion_ref_slug": clip.motion_ref_slug,
            "motion_ref_url": clip_ref_video_url,
            "storage_path": new_clip_storage_path,
            "mp4_path": new_clip_storage_path,
            "status": "done",
            "cost_usd": cost_usd,
            "completed_at": "now()",
            "regen_of_clip_id": target_parent_clip["id"],
        }).execute()
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            sb.table("clips").insert({
                "job_id": job_id,
                "index": parent_c["index"],
                "voiceover": parent_c["voiceover"],
                "visual_prompt": parent_c["visual_prompt"],
                "setting_id": parent_c["setting_id"],
                "duration_s": parent_c["duration_s"],
                "motion_ref_slug": parent_c.get("motion_ref_slug"),
                "motion_ref_url": parent_c.get("motion_ref_url"),
                "storage_path": parent_c["storage_path"],
                "mp4_path": parent_c["storage_path"],
                "status": "done",
                "cost_usd": 0,
                "completed_at": "now()",
                "regen_of_clip_id": parent_c["id"],
            }).execute()

        # Stitch: regen'd clip on local disk, parent clips downloaded.
        set_status("stitching", "Stitching final video")
        clip_paths_by_index: dict[int, Path] = {target_index: local_path}
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                continue
            clip_paths_by_index[parent_c["index"]] = _ensure_local(
                sb, work_dir, parent_c["storage_path"]
            )
        ordered = [clip_paths_by_index[i] for i in sorted(clip_paths_by_index)]
        final_mp4 = work_dir / "final.mp4"
        concat_clips(ordered, final_mp4)

        # Upload final + thumbnail + insert videos row.
        final_storage_path = f"jobs/{job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={
                    "content-type": "video/mp4", "upsert": "true",
                },
            )
        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(
                thumb_local, f"jobs/{job_id}/thumb.png"
            )
        except Exception as thumb_err:
            print(
                f"[thumb] regen_clip_from_text skipped: "
                f"{type(thumb_err).__name__}: {thumb_err}"
            )
        # Compute spoken_script from the actual clip set that's about
        # to be stitched: the freshly-rendered target clip plus all
        # parent clips at their other indices. The new clip's voiceover
        # is from `clip` (the in-memory model we just rendered); the
        # rest come from parent_clips. spoken_script is what the public
        # website renders below the player — keep it tied to what was
        # JUST stitched, not the original clip_plan.full_script (which
        # goes stale the moment Yonah edits any voiceover text).
        stitched_clips: list[dict] = []
        for parent_c in parent_clips:
            if parent_c["index"] == target_index:
                stitched_clips.append({
                    "index": target_index,
                    "voiceover": clip.voiceover,
                })
            else:
                stitched_clips.append({
                    "index": parent_c["index"],
                    "voiceover": parent_c.get("voiceover"),
                })
        spoken_script = _build_spoken_script(stitched_clips)

        video_row: dict = {
            "job_id": job_id,
            "mp4_path": final_storage_path,
            "spoken_script": spoken_script,
        }
        if thumb_storage_path:
            video_row["thumb_path"] = thumb_storage_path
        video_row.update(_resolve_video_title_fields(sb, job_id))
        sb.table("videos").insert(video_row).execute()

        set_status("done", "Re-rendered clip")
        sb.table("jobs").update({"completed_at": "now()"}).eq("id", job_id).execute()

        # Re-query the inserted videos row's id for the webhook payload.
        # (Supabase Python's insert() doesn't accept a chained .select()
        # like the JS client does — the earlier `.insert(...).select("id")`
        # syntax raised AttributeError and crashed every regen on
        # 2026-05-06 between commits d0bff94 and the fix here. Match the
        # pattern regen_single_clip uses: separate SELECT after the insert.)
        new_video_id: str | None = None
        try:
            video_lookup = (
                sb.table("videos").select("id")
                .eq("job_id", job_id)
                .order("created_at", desc=True).limit(1)
                .execute().data
            )
            new_video_id = video_lookup[0]["id"] if video_lookup else None
        except Exception as lookup_err:
            print(
                f"[regen_clip_from_text] video_id lookup failed: "
                f"{type(lookup_err).__name__}: {lookup_err}"
            )

        # Success webhook → dashboard /api/pipeline/video-complete fires the
        # Resend "your render is ready" email. Without this Yonah never
        # gets notified that a per-clip re-render finished — every other
        # render flow (run_pipeline, regen_smart, regen_single_clip,
        # compose_video) hits this same endpoint, so we match the pattern.
        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret and new_video_id:
                import httpx
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={"jobId": job_id, "videoId": new_video_id},
                    )
                    print(
                        f"[autopilot] regen_clip_from_text webhook "
                        f"{resp.status_code} for job {job_id}"
                    )
            else:
                print(
                    f"[autopilot] regen_clip_from_text skipped webhook — "
                    f"missing DASHBOARD_URL / PIPELINE_WEBHOOK_SECRET / "
                    f"video_id (job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[autopilot] regen_clip_from_text webhook failed: "
                f"{type(hook_err).__name__}: {hook_err}"
            )

        return {
            "status": "done",
            "clip_index": target_index,
            "new_clip_id": new_clip.data[0]["id"] if new_clip.data else None,
        }

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}"[:2000],
        }).eq("id", job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.regen_clip_from_text.failed",
            subject_type="job", subject_id=job_id,
            message=f"regen_clip_from_text {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "regen_clip_from_text",
            },
        )
        # Failure webhook → dashboard /api/pipeline/video-failed fires the
        # Resend "your render failed" email. Wrapped in its own try so a
        # webhook outage doesn't mask the original exception.
        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx
                with httpx.Client(timeout=5.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-failed",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": job_id,
                            "errorMessage": f"{type(e).__name__}: {e}",
                            "stage": "regen_clip_from_text",
                        },
                    )
                    print(
                        f"[fail-notify] regen_clip_from_text webhook "
                        f"{resp.status_code} for job {job_id}: "
                        f"{resp.text[:200]}"
                    )
            else:
                print(
                    f"[fail-notify] regen_clip_from_text skipped webhook — "
                    f"missing DASHBOARD_URL / PIPELINE_WEBHOOK_SECRET "
                    f"(job {job_id})"
                )
        except Exception as hook_err:
            print(
                f"[fail-notify] regen_clip_from_text webhook failed: "
                f"{type(hook_err).__name__}: {hook_err}"
            )
        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def regen_clip_from_text_endpoint(payload: dict, request: Request) -> dict:
    """HTTP entry point for regen_clip_from_text. Auth + idempotency
    identical to regen_single_clip_endpoint.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-regen-clip-from-text-endpoint.modal.run

    The dashboard derives this URL from MODAL_WORKER_URL by string-
    replacing 'pipeline-trigger' with
    'pipeline-regen-clip-from-text-endpoint'.

    Payload (POST JSON):
      { "job_id": "<uuid>" }
    The job's regen_of_job_id and feedback_clip_index columns carry
    the authoritative parent + target index.
    """
    job_id_for_log = payload.get("job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(
            f"[regen_clip_from_text_endpoint] config_error "
            f"job_id={job_id_for_log} reason=secret-not-set"
        )
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[regen_clip_from_text_endpoint] auth_fail "
            f"job_id={job_id_for_log} incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}

    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(
                f"[regen_clip_from_text_endpoint] skip_terminal "
                f"job_id={job_id} status={status}"
            )
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[regen_clip_from_text_endpoint] skip_in_flight "
                        f"job_id={job_id} status={status} "
                        f"age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    regen_clip_from_text.spawn(job_id)
    return {"ok": True, "job_id": job_id, "mode": "regen_clip_from_text"}


# --- Compose ---------------------------------------------------------
# Stitch a user-chosen ordered list of existing clip mp4s into a new
# final video. No Seedance, no Claude — just download + loudnorm +
# concat. Lets the user mix-and-match clips across multiple regen
# attempts (e.g. clip 1 from v3, clip 2 from v7, clip 3 from v5).
@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=30 * 60,
)
def compose_video(compose_job_id: str) -> dict | None:
    """Stitch a user-chosen ordered list of clip_ids into a final video.

    Pre-conditions enforced by compose-video.ts:
      - compose job has kind='compose'
      - the videos row for this job has composed_from_clip_ids set
        (a non-empty ordered jsonb array of clip UUIDs, one per slot
        in order 0..N-1)
      - all referenced clips have storage_path populated
    """
    sys.path.insert(0, "/root")
    from supabase import create_client
    from src.stitcher import loudnorm_then_concat
    from src.thumbnails import extract_thumbnail, upload_thumbnail
    from src.events import log_event

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    pre = (
        sb.table("jobs").select("status").eq("id", compose_job_id)
        .maybe_single().execute()
    )
    if pre and pre.data and pre.data.get("status") in _TERMINAL_STATUSES:
        return {"status": "already_done"}

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", compose_job_id).execute()
        log_event(
            sb, actor="modal", level="info",
            event=f"pipeline.status.{status}",
            subject_type="job", subject_id=compose_job_id,
            message=message or status,
            details={"status": status, "mode": "compose"},
        )

    try:
        set_status("loading_parsha", "Loading clips for compose")

        compose_video_row = (
            sb.table("videos")
            .select("id, composed_from_clip_ids")
            .eq("job_id", compose_job_id)
            .single().execute().data
        )
        clip_ids = compose_video_row.get("composed_from_clip_ids") or []
        if not clip_ids:
            raise ValueError(
                f"compose job {compose_job_id} has empty "
                f"composed_from_clip_ids"
            )

        # Resolve each clip_id to its storage_path + voiceover. Order
        # matters — clip_ids is already in slot order (0..N-1).
        # Pulling voiceover here so we can compute spoken_script from
        # the actual clip set being stitched (not from the original
        # clip_plan.full_script which goes stale after per-clip edits).
        clip_rows = (
            sb.table("clips").select("id, storage_path, index, voiceover")
            .in_("id", clip_ids).execute().data
        ) or []
        by_id = {c["id"]: c for c in clip_rows}
        ordered: list[dict] = []
        for cid in clip_ids:
            row = by_id.get(cid)
            if not row or not row.get("storage_path"):
                raise ValueError(
                    f"clip {cid} missing or has no storage_path"
                )
            ordered.append(row)

        # Download each to work dir.
        work_dir = Path(f"/tmp/compose-{compose_job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)
        local_paths: list[Path] = []
        for row in ordered:
            local_paths.append(
                _ensure_local(sb, work_dir, row["storage_path"])
            )

        # Loudnorm + concat.
        set_status("stitching", f"Stitching {len(local_paths)} clip(s)")
        final_mp4 = work_dir / "final.mp4"
        loudnorm_then_concat(local_paths, final_mp4)

        # Upload final + thumbnail.
        final_storage_path = f"jobs/{compose_job_id}/final.mp4"
        with open(final_mp4, "rb") as f:
            sb.storage.from_("videos").upload(
                final_storage_path, f.read(),
                file_options={
                    "content-type": "video/mp4", "upsert": "true",
                },
            )
        thumb_storage_path: str | None = None
        try:
            thumb_local = work_dir / "thumb.png"
            extract_thumbnail(final_mp4, thumb_local, percent=20.0)
            thumb_storage_path = upload_thumbnail(
                thumb_local, f"jobs/{compose_job_id}/thumb.png"
            )
        except Exception as thumb_err:
            print(
                f"[thumb] compose skipped: "
                f"{type(thumb_err).__name__}: {thumb_err}"
            )

        # Compute spoken_script from the clips actually composed in
        # slot order. Phonetic guides ("Ba-MID-bar" etc.) stripped so
        # the website reads clean. Mirrors regen_clip_from_text — every
        # stitch point keeps spoken_script in sync with what was just
        # rendered. (Yonah, 2026-05-15: "the script should always
        # reflect the current full video selected on screen.")
        # Re-pulling voiceovers with index in case clip_rows ordering
        # doesn't match slot order from clip_ids.
        spoken_clips: list[dict] = []
        for slot, row in enumerate(ordered):
            spoken_clips.append({
                "index": slot,
                "voiceover": row.get("voiceover"),
            })
        spoken_script = _build_spoken_script(spoken_clips)

        # Update the pre-existing videos row with the final mp4 path.
        update: dict = {
            "mp4_path": final_storage_path,
            "spoken_script": spoken_script,
        }
        if thumb_storage_path:
            update["thumb_path"] = thumb_storage_path
        sb.table("videos").update(update).eq(
            "id", compose_video_row["id"]
        ).execute()

        set_status("done", "Compose ready")
        sb.table("jobs").update({"completed_at": "now()"}).eq(
            "id", compose_job_id
        ).execute()

        # Webhook to dashboard (compose is parsha-adjacent — same hook).
        try:
            dashboard_url = os.environ.get("DASHBOARD_URL")
            webhook_secret = os.environ.get("PIPELINE_WEBHOOK_SECRET")
            if dashboard_url and webhook_secret:
                import httpx
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(
                        f"{dashboard_url.rstrip('/')}/api/pipeline/video-complete",
                        headers={"x-pipeline-secret": webhook_secret},
                        json={
                            "jobId": compose_job_id,
                            "videoId": compose_video_row["id"],
                        },
                    )
                    print(
                        f"[autopilot] compose webhook {resp.status_code} "
                        f"for job {compose_job_id}"
                    )
        except Exception as hook_err:
            print(
                f"[autopilot] compose webhook failed: "
                f"{type(hook_err).__name__}: {hook_err}"
            )

        return {"status": "done", "video_id": compose_video_row["id"]}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        sb.table("jobs").update({
            "status": "failed",
            "error_message": f"{type(e).__name__}: {e}\n{tb}",
        }).eq("id", compose_job_id).execute()
        log_event(
            sb, actor="modal", level="error",
            event="pipeline.failed",
            subject_type="job", subject_id=compose_job_id,
            message=f"compose_video {type(e).__name__}: {e}",
            details={
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback": tb,
                "mode": "compose",
            },
        )
        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("torah-tai-chi-env"),
        modal.Secret.from_name("torah-tai-chi-pipeline-secrets"),
    ],
    timeout=60 * 60,
)
@modal.fastapi_endpoint(method="POST")
def compose_video_endpoint(payload: dict, request: Request) -> dict:
    """Compose-video trigger.

    Auth + idempotency identical to regen_agent_endpoint. The dashboard's
    compose-video action targets this endpoint after inserting the job
    + pre-populating the videos row's composed_from_clip_ids.

    Deployed URL pattern (after `modal deploy modal_app.py`):
      https://<account>--torah-tai-chi-pipeline-compose-video-endpoint.modal.run

    Payload (POST JSON):
      { "compose_job_id": "<uuid>" }
    """
    job_id_for_log = payload.get("compose_job_id") or "<no-job-id>"
    secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    if not secret:
        print(
            f"[compose_video_endpoint] config_error "
            f"job_id={job_id_for_log} reason=secret-not-set"
        )
        raise HTTPException(status_code=503, detail="trigger secret not configured")
    incoming = request.headers.get("x-pipeline-secret") or ""
    if len(incoming) != len(secret) or not hmac.compare_digest(incoming, secret):
        print(
            f"[compose_video_endpoint] auth_fail "
            f"job_id={job_id_for_log} incoming_len={len(incoming)}"
        )
        raise HTTPException(status_code=403, detail="forbidden")

    job_id = payload.get("compose_job_id")
    if not job_id:
        return {"error": "compose_job_id required"}

    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    existing = (
        sb.table("jobs")
        .select("status, triggered_at")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        status = existing.data.get("status")
        if status in _TERMINAL_STATUSES:
            print(
                f"[compose_video_endpoint] skip_terminal "
                f"job_id={job_id} status={status}"
            )
            return {"status": "skipped", "reason": f"job already {status}"}
        if status in _IN_FLIGHT_STATUSES:
            triggered_at_str = existing.data.get("triggered_at")
            if triggered_at_str:
                triggered_at = datetime.fromisoformat(
                    triggered_at_str.replace("Z", "+00:00")
                )
                age = datetime.now(timezone.utc) - triggered_at
                if age < _STUCK_AFTER:
                    print(
                        f"[compose_video_endpoint] skip_in_flight "
                        f"job_id={job_id} status={status} "
                        f"age_s={age.total_seconds():.0f}"
                    )
                    return {
                        "status": "skipped",
                        "reason": (
                            f"job is {status}, in-flight for "
                            f"{age.total_seconds():.0f}s"
                        ),
                    }

    compose_video.spawn(job_id)
    return {"ok": True, "compose_job_id": job_id, "mode": "compose"}
