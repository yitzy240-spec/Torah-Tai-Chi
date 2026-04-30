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
    "generating_clips", "stitching",
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

    # Spawn the work async so we return 200 to Vercel quickly
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

        if kind == "topic":
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

        # Plan + previous final video are always replaced — they're
        # cheap to regenerate and we want them to reflect the latest
        # plan, not whatever the prior run wrote.
        sb.table("clip_plans").delete().eq("job_id", job_id).execute()
        sb.table("videos").delete().eq("job_id", job_id).execute()

        if reusable_indices:
            print(
                f"[modal_app] resume: reusing {len(reusable_indices)} of "
                f"{len(plan.clips)} clips from prior run "
                f"(indices={sorted(reusable_indices)})"
            )
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

        # --- Generate clips (in parallel — Kie.ai polling is mostly I/O wait) ---
        set_status("generating_clips", f"Generating 0 of {len(plan.clips)} clips")

        async def _generate_all() -> list[Path]:
            completed = 0
            lock = asyncio.Lock()

            async def _one(clip):
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

                _, kie_meta = await generate_clip_with_meta(
                    kie, clip,
                    character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                    dest=dest, resolution=resolution,
                    model=seedance_model,
                    reference_video_url=clip_ref_video_url,
                )
                async with lock:
                    completed += 1
                    set_status("generating_clips", f"Generating {completed} of {len(plan.clips)} clips")
                # Kie returns credits used (their pricing model is $5/1000
                # credits = $0.005/credit). Multiply to USD before storing
                # in cost_usd, since downstream callers (dashboard total,
                # cost rollup, monthly budget) all assume USD.
                credits = (
                    kie_meta.get("creditsConsumed")
                    or kie_meta.get("credits_consumed")
                    or kie_meta.get("costCredits")
                    or kie_meta.get("cost")
                )
                real_cost_usd = (
                    float(credits) * KIE_CREDITS_TO_USD if credits is not None else None
                )
                # Persist this clip to Storage immediately so a Modal
                # worker preempt mid-pipeline doesn't lose already-paid
                # clips, AND so per-clip surgery (regen ONE clip and
                # re-stitch using the rest) has the originals to pull
                # back. Without this the only mp4 that ever leaves Modal
                # is the final stitched one, making surgery impossible.
                clip_storage_path = (
                    f"jobs/{job_id}/clips/clip_{clip.index:02d}.mp4"
                )
                with open(dest, "rb") as cf:
                    sb.storage.from_("videos").upload(
                        clip_storage_path, cf.read(),
                        file_options={
                            "content-type": "video/mp4",
                            "upsert": "true",
                        },
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
                }
                if clip_ref_video_url:
                    clip_update["motion_ref_url"] = clip_ref_video_url
                sb.table("clips").update(clip_update).eq("job_id", job_id).eq("index", clip.index).execute()
                if real_cost_usd is not None:
                    log_cost("clip", "kie", real_cost_usd, f"clip {clip.index} ({credits} credits)")
                else:
                    print(f"[modal_app] no cost field in Kie response for clip {clip.index}; "
                          f"meta keys={list(kie_meta.keys())}")
                return dest

            ordered = await asyncio.gather(*(_one(c) for c in plan.clips))
            return [p for p in ordered]

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


async def _upload_dir(kie: "KieClient", dir_path: Path, label: str) -> list[str]:  # noqa: F821
    urls: list[str] = []
    for img in sorted(dir_path.glob("*.png")):
        url = await kie.upload_file(img, remote_dir=f"torah-tai-chi/refs/{label}")
        urls.append(url)
    return urls


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
            _, kie_meta = await generate_clip_with_meta(
                kie, target_clip_pydantic,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=local_path, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
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

        set_status("generating_clips", f"Regenerating clip {target_index}")
        new_local_path = work_dir / f"clip_{target_index:02d}.mp4"
        clip_ref_video_url = (
            motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
        )

        async def _regen_one():
            return await generate_clip_with_meta(
                kie, target_clip_pydantic,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=new_local_path, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
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
    raw = await claude_call(
        messages=[{"role": "user", "content": user_prompt}],
        system=_REGEN_AGENT_EXECUTE_PROMPT,
        model="claude-haiku-4-5-20251001",
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

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        # 8. Regenerate the changed clips IN PARALLEL (asyncio.gather) —
        #    same shape as regen_smart's _regen_all.
        new_clips_by_index = {c.index: c for c in new_plan.clips}
        parent_by_index = {c["index"]: c for c in parent_clips}

        async def _regen_one(target_idx: int):
            target_clip_pydantic = new_clips_by_index[target_idx]
            local_path = work_dir / f"clip_{target_idx:02d}.mp4"
            clip_ref_video_url = (
                motion_ref_mp4_url if target_clip_pydantic.motion_ref_slug else None
            )
            _, kie_meta = await generate_clip_with_meta(
                kie, target_clip_pydantic,
                character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                dest=local_path, resolution=resolution,
                model=seedance_model,
                reference_video_url=clip_ref_video_url,
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

        # 9. Insert new clip rows + upload to Storage for changed clips.
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
                    f"regen_agent clip {target_idx} ({credits} credits)",
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
        for target_idx, local_path, _kie_meta, _credits, _cost_usd, _ref_url in regen_results:
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
