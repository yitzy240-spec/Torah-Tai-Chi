-- Enable Supabase Realtime on tables needed for live page updates
-- (spec §11.3 / plan Task 1.6). The page subscribes to these tables
-- filtered by parsha_id so clip rendering, video stitching, and post
-- status changes all update the UI without a refresh.
--
-- jobs is NOT listed here — check whether it is already published before
-- re-running. This migration adds only the four new tables; re-running is
-- safe because ALTER PUBLICATION ... ADD TABLE is idempotent in Postgres
-- (no error if the table is already a member).

ALTER PUBLICATION supabase_realtime ADD TABLE clips;
ALTER PUBLICATION supabase_realtime ADD TABLE videos;
ALTER PUBLICATION supabase_realtime ADD TABLE posts;
ALTER PUBLICATION supabase_realtime ADD TABLE clip_plans;
