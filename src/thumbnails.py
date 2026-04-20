"""Extract a thumbnail frame from an mp4 at a given timestamp.

Usage:
    from pathlib import Path
    from src.thumbnails import extract_thumbnail, upload_thumbnail

    thumb = extract_thumbnail(Path("output/bereishit-a-v2.mp4"), Path("output/bereishit-thumb.png"))
    storage_path = upload_thumbnail(thumb, "parsha/bereishit/thumb.png")
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import httpx


def get_video_duration(mp4: Path) -> float:
    """Return video duration in seconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            str(mp4),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def extract_thumbnail(mp4: Path, dest: Path, percent: float = 20.0) -> Path:
    """Extract a frame at `percent`% of the video duration.

    Returns path to the extracted PNG. Scales to 480x854 (9:16 portrait).
    Requires ffmpeg on PATH.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)

    duration = get_video_duration(mp4)
    timestamp = duration * (percent / 100.0)

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss", f"{timestamp:.3f}",
            "-i", str(mp4),
            "-frames:v", "1",
            "-vf", "scale=480:854:force_original_aspect_ratio=decrease,pad=480:854:(ow-iw)/2:(oh-ih)/2",
            str(dest),
        ],
        check=True,
        capture_output=True,
    )
    return dest


def upload_thumbnail(local_path: Path, storage_path: str) -> str:
    """Upload a thumbnail PNG to Supabase Storage (videos bucket).

    Returns the storage_path on success (the value to store in videos.thumb_path).
    Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment.
    """
    supabase_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    # storage_path should NOT start with a slash
    storage_path = storage_path.lstrip("/")

    url = f"{supabase_url}/storage/v1/object/videos/{storage_path}"
    image_bytes = local_path.read_bytes()

    response = httpx.put(
        url,
        content=image_bytes,
        headers={
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
        timeout=60,
    )
    response.raise_for_status()
    return storage_path


def generate_placeholder(dest: Path) -> Path:
    """Generate a 480x854 brand placeholder PNG using ImageMagick (convert).

    Falls back to a minimal solid-color PNG via ffmpeg if ImageMagick is unavailable.
    The placeholder uses warm linen background (#FAF4E8) with centered text.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)

    try:
        subprocess.run(
            [
                "convert",
                "-size", "480x854",
                f"xc:#FAF4E8",
                "-gravity", "Center",
                "-font", "Helvetica",
                "-pointsize", "28",
                "-fill", "#7B5E38",
                "-annotate", "+0-60", "Torah Tai Chi",
                "-pointsize", "18",
                "-fill", "#A07840",
                "-annotate", "+0+0", "☯ Torah · Breath · Body",
                "-pointsize", "14",
                "-fill", "#B09070",
                "-annotate", "+0+60", "Coming soon",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        # ImageMagick not available — use ffmpeg to create a solid-color PNG
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f", "lavfi",
                "-i", "color=c=0xFAF4E8:size=480x854:rate=1",
                "-frames:v", "1",
                "-vf", "drawtext=text='Torah Tai Chi':fontcolor=0x7B5E38:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
    return dest
