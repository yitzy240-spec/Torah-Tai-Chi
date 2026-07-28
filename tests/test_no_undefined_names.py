"""Gate: no undefined names in the Modal pipeline code.

Why this exists (2026-07-28, Eikev): modal_app.py functions import shared
helpers LOCALLY inside each function body (the Modal-image pattern — imports
must run inside the container, not at module load on the dashboard side).
That pattern makes it easy to add a call to a helper without adding the
function-local import. It has now bitten twice:

  - reap_stranded_jobs called emit_job_event/log_event without local imports
    (fixed in abbdd7d), and
  - compose_video's spinner fix (e8896f9) added emit_job_event calls with no
    local import, so EVERY stitch from 2026-07-20 to 2026-07-27 crashed with
    NameError on its first set_status — before doing any work. The except
    handler hit the same NameError before broadcasting 'failed', so the
    operator saw an infinite "Stitching your video…" spinner all night.

A NameError of this class is invisible to pytest (tests import src/, not the
Modal function bodies) and to tsc — only static name analysis catches it.
Ruff's F821 respects the intentional `# noqa: F821` markers on string type
annotations (e.g. "KieClient"), so anything it reports is a real runtime bomb.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_no_undefined_names_in_pipeline_code():
    result = subprocess.run(
        [
            sys.executable, "-m", "ruff", "check",
            "--select", "F821", "--no-cache",
            "modal_app.py", "src",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        "Undefined names in pipeline code — these are runtime NameErrors "
        "waiting to fire inside Modal (see docstring for the compose_video "
        f"incident):\n{result.stdout}\n{result.stderr}"
    )
