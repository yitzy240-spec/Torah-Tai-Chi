"""Modal app that runs the Torah Tai Chi pipeline when triggered via HTTP.

Deploy: modal deploy modal_app.py
Worker URL after deploy (e.g. https://<account>--torah-tai-chi-pipeline-trigger.modal.run)
is what Next.js puts in MODAL_WORKER_URL.

The worker itself runs in Modal's Python sandbox. Uses the same src/ modules
as the CLI does — no pipeline logic is duplicated here.
"""
from __future__ import annotations
import asyncio
import os
import sys
import time
from pathlib import Path

import modal

app = modal.App("torah-tai-chi-pipeline")

# The Modal image: base Python + ffmpeg + our src/ + dependencies.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "anthropic>=0.40.0",
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


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("torah-tai-chi-env")],  # contains ANTHROPIC_API_KEY, KIE_AI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    timeout=60 * 60,  # 1 hour max
)
@modal.fastapi_endpoint(method="POST")
def trigger(payload: dict) -> dict:
    job_id = payload.get("job_id")
    if not job_id:
        return {"error": "job_id required"}
    # Spawn the work async so we return 200 to Vercel quickly
    run_pipeline.spawn(job_id)
    return {"ok": True, "job_id": job_id}


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("torah-tai-chi-env")],
    timeout=60 * 60,
)
def run_pipeline(job_id: str) -> None:
    sys.path.insert(0, "/root")
    # Import after path setup so src/ modules resolve
    from supabase import create_client
    from src.script_generator import transform_draft_to_clip_plan
    from src.video_generator import generate_clip
    from src.stitcher import concat_clips
    from src.kie_client import KieClient
    from src.models import ClipPlan
    from src.thumbnails import extract_thumbnail, upload_thumbnail

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    def set_status(status: str, message: str | None = None) -> None:
        update = {"status": status}
        if message is not None:
            update["status_message"] = message
        sb.table("jobs").update(update).eq("id", job_id).execute()

    def log_cost(action: str, vendor: str, cost_usd: float, notes: str | None = None) -> None:
        sb.table("cost_events").insert({
            "job_id": job_id, "action": action, "vendor": vendor,
            "cost_usd": cost_usd, "notes": notes,
        }).execute()
        # Bump the job's running total
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()

    try:
        set_status("loading_parsha", "Loading parsha and script")
        job = sb.table("jobs").select("parsha_id, script_id").eq("id", job_id).single().execute().data
        parsha = sb.table("parshiot").select("name, book").eq("id", job["parsha_id"]).single().execute().data
        script = sb.table("scripts").select("option, title, style_note, draft_text").eq("id", job["script_id"]).single().execute().data

        work_dir = Path(f"/tmp/job-{job_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        # --- Script → ClipPlan via Claude ---
        set_status("generating_plan", "Claude is writing the clip plan")
        plan = asyncio.run(transform_draft_to_clip_plan(
            parsha_name=parsha["name"], book=parsha["book"],
            option=script["option"], style_note=script["style_note"] or "",
            title=script["title"], draft=script["draft_text"],
            api_key=os.environ["ANTHROPIC_API_KEY"],
        ))
        sb.table("clip_plans").insert({
            "job_id": job_id, "plan_json": plan.model_dump(mode="json"),
            "claude_cost_usd": 0.10,
        }).execute()
        log_cost("clipplan", "anthropic", 0.10, "ClipPlan generation")
        for c in plan.clips:
            sb.table("clips").insert({
                "job_id": job_id, "index": c.index, "voiceover": c.voiceover,
                "visual_prompt": c.visual_prompt, "setting_id": c.setting_id,
                "duration_s": c.duration_s,
            }).execute()

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
                await generate_clip(
                    kie, clip,
                    character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
                    dest=dest, resolution="720p",
                )
                async with lock:
                    completed += 1
                    set_status("generating_clips", f"Generating {completed} of {len(plan.clips)} clips")
                sb.table("clips").update({
                    "mp4_path": f"internal/{dest.name}",
                    "status": "done", "cost_usd": 1.20,
                    "completed_at": "now()",
                }).eq("job_id", job_id).eq("index", clip.index).execute()
                log_cost("clip", "kie", 1.20, f"clip {clip.index}")
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

    except Exception as e:
        import traceback
        sb.table("jobs").update({
            "status": "failed", "error_message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        }).eq("id", job_id).execute()
        raise


async def _upload_dir(kie: "KieClient", dir_path: Path, label: str) -> list[str]:  # noqa: F821
    urls: list[str] = []
    for img in sorted(dir_path.glob("*.png")):
        url = await kie.upload_file(img, remote_dir=f"torah-tai-chi/refs/{label}")
        urls.append(url)
    return urls
