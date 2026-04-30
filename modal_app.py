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
        sb.table("clip_plans").insert({
            "job_id": job_id, "plan_json": plan.model_dump(mode="json"),
            "claude_cost_usd": 0.10,
        }).execute()
        # Claude is now billed through Kie (single-vendor consolidation);
        # vendor tag updated so the dashboard cost rollup attributes correctly.
        log_cost("clipplan", "kie", 0.10, "ClipPlan generation (Claude via Kie)")
        for c in plan.clips:
            sb.table("clips").insert({
                "job_id": job_id, "index": c.index, "voiceover": c.voiceover,
                "visual_prompt": c.visual_prompt, "setting_id": c.setting_id,
                "duration_s": c.duration_s,
                "motion_ref_slug": c.motion_ref_slug,
            }).execute()

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
                clip_update = {
                    "mp4_path": f"internal/{dest.name}",
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
