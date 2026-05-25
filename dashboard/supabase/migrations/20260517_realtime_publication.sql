-- Enable Supabase Realtime on tables needed for live page updates
-- (spec §11.3 / plan Task 1.6). The page subscribes to these tables
-- filtered by parsha_id so clip rendering, video stitching, and post
-- status changes all update the UI without a refresh.
--
-- ALTER PUBLICATION ... ADD TABLE is NOT idempotent in Postgres — it
-- raises 42710 (duplicate_object) if the table is already a member.
-- Wrap each add in a DO block so a re-run skips existing members
-- without aborting the whole migration. (Hit this on the 2026-05-25
-- prod apply when `clips` was already in supabase_realtime from an
-- earlier ad-hoc setup.)

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE clips;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'clips already in supabase_realtime — skipping';
END$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE videos;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'videos already in supabase_realtime — skipping';
END$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE posts;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'posts already in supabase_realtime — skipping';
END$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE clip_plans;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'clip_plans already in supabase_realtime — skipping';
END$$;
