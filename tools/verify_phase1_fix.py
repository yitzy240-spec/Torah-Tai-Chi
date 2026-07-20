"""READ-ONLY: prove the Phase-1 wrong-script fix on REAL Va'etchanan data.

Shows: the script the live draft plan was built from, that parsha's A-tight
script, and the OLD vs NEW "Generate" decision on a Back-to-Phase-1 round-trip.
"""
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env(name: str) -> str:
    for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if l.startswith(name + "="):
            return l.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{name} not in .env")


def _url(key: str) -> str:
    import base64, json
    p = key.split(".")[1]
    p += "=" * (-len(p) % 4)
    return f"https://{json.loads(base64.urlsafe_b64decode(p))['ref']}.supabase.co"


def resolve_plan_root(jobs_by_id: dict, job_id: str | None):
    """Mirror resolvePlanJobId: walk regen_of_job_id to the plan-only root."""
    seen = set()
    cur = job_id
    while cur:
        if cur in seen:
            return None
        seen.add(cur)
        j = jobs_by_id.get(cur)
        if not j:
            return None
        if not j.get("regen_of_job_id"):
            return cur
        cur = j["regen_of_job_id"]
    return None


def should_start_new_plan(draft_script_id, requested_script_id):
    if draft_script_id is None:
        return True
    return draft_script_id != requested_script_id


def get_phase1_default(scripts, draft_script_id):
    """Mirror getPhase1Props default-script resolution."""
    by_id = {s["id"]: s for s in scripts}
    if draft_script_id and draft_script_id in by_id:
        return draft_script_id
    for opt in ("A-tight", "A"):
        for s in scripts:
            if s["option"] == opt:
                return s["id"]
    return scripts[0]["id"] if scripts else None


def main():
    from supabase import create_client
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    sb = create_client(_url(key), key)

    par = sb.table("parshiot").select("id, slug").eq("slug", "va-etchanan").single().execute().data
    pid = par["id"]

    scripts = (
        sb.table("scripts").select("id, option").eq("parsha_id", pid).execute().data or []
    )
    print("=== Va'etchanan scripts ===")
    for s in scripts:
        print(f"  {s['id'][:8]}  option={s['option']}")

    jobs = (
        sb.table("jobs")
        .select("id, kind, status, script_id, regen_of_job_id, triggered_at, completed_at")
        .eq("parsha_id", pid).order("triggered_at", desc=True).limit(40).execute().data or []
    )
    by_id = {j["id"]: j for j in jobs}
    # The "draft" = the most recent non-purged lineage's plan-only root. Use the
    # latest job with a plan lineage.
    latest = jobs[0] if jobs else None
    root_id = resolve_plan_root(by_id, latest["id"]) if latest else None
    root = by_id.get(root_id) if root_id else None
    draft_script_id = root.get("script_id") if root else None

    print(f"\nlatest job: {latest['id'][:8] if latest else None} kind={latest['kind'] if latest else '-'}")
    print(f"resolved plan root: {root_id[:8] if root_id else None}  built from script: {draft_script_id[:8] if draft_script_id else None}")

    atight = next((s["id"] for s in scripts if s["option"] == "A-tight"), None)
    draft_opt = next((s["option"] for s in scripts if s["id"] == draft_script_id), "MISSING")
    print(f"draft script option = {draft_opt!r}; A-tight script = {atight[:8] if atight else None}")

    print("\n=== Back-to-Phase-1 → Generate (no script change) ===")
    old_default = atight or (scripts[0]["id"] if scripts else None)  # OLD code always A-tight
    new_default = get_phase1_default(scripts, draft_script_id)        # NEW code prefers draft
    old_regen = should_start_new_plan(draft_script_id, old_default)
    new_regen = should_start_new_plan(draft_script_id, new_default)
    print(f"  OLD: Phase 1 preselects {old_default[:8] if old_default else None} → regenerate/orphan? {old_regen}")
    print(f"  NEW: Phase 1 preselects {new_default[:8] if new_default else None} → regenerate/orphan? {new_regen}")
    verdict = "FIX PREVENTS THE ORPHAN" if (old_regen and not new_regen) else \
              ("no difference (draft WAS A-tight)" if draft_script_id == atight else "CHECK")
    print(f"  => {verdict}")


if __name__ == "__main__":
    main()
