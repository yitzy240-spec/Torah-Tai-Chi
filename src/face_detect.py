"""CPU face detection for hook placement (YuNet, no paid API)."""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

YUNET_MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "references" / "models" / "face_detection_yunet_2023mar.onnx"
)
# YuNet scores on Rav Eli were ~0.92; 0.5 drops the spurious low-score boxes.
MIN_FACE_SCORE = 0.50
# Ignore tiny side detections (leaves, ornaments).
MIN_FACE_HEIGHT_FRAC = 0.08
# Prefer a face whose centre is in the middle of the 9:16 frame.
MIN_CENTER_X_FRAC = 0.20
MAX_CENTER_X_FRAC = 0.80
# Extend the box upward so a kippah above YuNet's hairline is cleared.
HEAD_PAD_FRAC = 0.10
HEAD_PAD_MIN_PX = 8
DEFAULT_SAMPLE_TIMES_S = (0.3, 1.0, 2.0)


@dataclass(frozen=True)
class FaceBox:
    """Axis-aligned face box in pixel coordinates (inclusive-exclusive)."""
    left: float
    top: float
    right: float
    bottom: float
    score: float

    @property
    def height(self) -> float:
        return max(0.0, self.bottom - self.top)

    def padded_top(self, *, video_h: int) -> float:
        pad = max(HEAD_PAD_MIN_PX, self.height * HEAD_PAD_FRAC)
        return max(0.0, self.top - pad)


def detect_faces_in_image(
    image,  # np.ndarray BGR
    *,
    model_path: Path | None = None,
    score_threshold: float = MIN_FACE_SCORE,
) -> list[FaceBox]:
    """Return YuNet face boxes for a single BGR image."""
    import cv2

    path = Path(model_path) if model_path else YUNET_MODEL_PATH
    if not path.is_file():
        raise FileNotFoundError(f"YuNet model missing: {path}")
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN_create(
        str(path), "", (width, height), float(score_threshold), 0.3, 5000,
    )
    if hasattr(detector, "setInputSize"):
        detector.setInputSize((width, height))
    result = detector.detect(image)
    faces = result[1] if isinstance(result, tuple) and len(result) == 2 else result
    if faces is None or len(faces) == 0:
        return []
    out: list[FaceBox] = []
    for row in faces:
        x, y, w, h = (float(row[0]), float(row[1]), float(row[2]), float(row[3]))
        score = float(row[-1]) if len(row) > 4 else 0.0
        out.append(FaceBox(left=x, top=y, right=x + w, bottom=y + h, score=score))
    return out


def _is_plausible_hero_face(face: FaceBox, video_w: int, video_h: int) -> bool:
    if face.height < video_h * MIN_FACE_HEIGHT_FRAC:
        return False
    cx = (face.left + face.right) / 2.0
    return video_w * MIN_CENTER_X_FRAC <= cx <= video_w * MAX_CENTER_X_FRAC


def pick_hero_face(faces: list[FaceBox], video_w: int, video_h: int) -> FaceBox | None:
    """The largest reasonably central face, if any."""
    candidates = [f for f in faces if _is_plausible_hero_face(f, video_w, video_h)]
    if not candidates:
        return None
    return max(candidates, key=lambda f: (f.height, f.score))


def _grab_frame_bgr(mp4: Path, time_s: float):
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(mp4))
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, time_s) * 1000.0)
        ok, frame = cap.read()
        cap.release()
        if ok and frame is not None:
            return frame
    # ffmpeg fallback when OpenCV's video I/O can't seek this file.
    result = subprocess.run(
        [
            os.environ.get("FFMPEG_BIN", "ffmpeg"), "-y",
            "-ss", f"{max(0.0, time_s):.3f}",
            "-i", str(mp4),
            "-frames:v", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "pipe:1",
        ],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        return None
    buf = np.frombuffer(result.stdout, dtype=np.uint8)
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def detect_face_in_clip(
    mp4: Path,
    *,
    end_s: float = 3.0,
    sample_times_s: tuple[float, ...] = DEFAULT_SAMPLE_TIMES_S,
    model_path: Path | None = None,
) -> FaceBox | None:
    """Sample the hook window and return the highest (smallest top) hero face.

    Using the highest detected head is conservative: the hook must clear
    the tightest close-up in the first few seconds. Returns None when
    OpenCV or the model is missing, or when no plausible face is found.
    """
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("[overlay] OpenCV not installed; hook placement will not adapt to the face")
        return None
    path = Path(model_path) if model_path else YUNET_MODEL_PATH
    if not path.is_file():
        print(f"[overlay] YuNet model missing at {path}; hook placement will not adapt")
        return None

    times = [t for t in sample_times_s if 0.0 <= t <= max(0.0, end_s)]
    if not times:
        times = [0.0]
    picked: list[FaceBox] = []
    for t in times:
        frame = _grab_frame_bgr(mp4, t)
        if frame is None:
            continue
        height, width = frame.shape[:2]
        hero = pick_hero_face(detect_faces_in_image(frame, model_path=path), width, height)
        if hero is not None:
            picked.append(hero)
    if not picked:
        return None
    # Highest head in the frame (smallest top) among accepted detections.
    return min(picked, key=lambda f: f.top)
