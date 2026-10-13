-- public.shift_clip_indexes_after_delete(p_job_id, p_deleted_index)
--
-- Called by dashboard/src/app/actions/video-page/remove-plan-clip.ts right
-- after it hard-deletes one clip row, to close the gap: every clip of the
-- job with index > p_deleted_index moves down by one, keeping indexes
-- contiguous (0..n-1).
--
-- No migration ever defined it, and prod has no such function (checked
-- 2026-10-13: prod has only increment_job_cost and videos_fill_parsha_id),
-- so in prod the RPC always errors and the action falls back to unchecked,
-- non-atomic per-row updates. Written from the call site's contract.
--
-- * One function call = one transaction: the shift is all-or-nothing.
-- * Rows move one at a time in ascending index order. clips_job_id_index_key
--   is a non-deferrable UNIQUE (job_id, index), which Postgres checks per
--   row, so a single `SET index = index - 1` can collide when rows happen to
--   be visited high-to-low. Ascending, each target slot is already free
--   (the deleted row's slot first). If p_deleted_index is still occupied,
--   the first move raises 23505 and nothing changes.
-- * SECURITY INVOKER (the default), not DEFINER: the only caller uses the
--   service-role client, which already bypasses RLS. A DEFINER function
--   exposed through PostgREST would let any anon/authenticated caller
--   re-index any job's clips. EXECUTE is revoked from everyone but
--   service_role for the same reason.
-- * search_path pinned so an object in another schema can't shadow
--   public.clips.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT can be re-run.

CREATE OR REPLACE FUNCTION public.shift_clip_indexes_after_delete(
  p_job_id uuid,
  p_deleted_index integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  moved integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.clips
    WHERE job_id = p_job_id AND index > p_deleted_index
    ORDER BY index ASC
  LOOP
    UPDATE public.clips SET index = index - 1 WHERE id = r.id;
    moved := moved + 1;
  END LOOP;
  RETURN moved;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_clip_indexes_after_delete(uuid, integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.shift_clip_indexes_after_delete(uuid, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.shift_clip_indexes_after_delete(uuid, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.shift_clip_indexes_after_delete(uuid, integer) TO service_role;
  END IF;
END $$;
