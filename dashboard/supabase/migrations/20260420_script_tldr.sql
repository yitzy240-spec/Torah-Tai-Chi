-- Scripts: add a short tldr (1-2 sentence concept summary) used by the
-- video-detail script carousel, and allow arbitrary option values (e.g.
-- 'custom-<timestamp>' rows generated from Yonah's freeform ideas) by
-- dropping the hard-coded A/B/C/A-tight check constraint.

alter table scripts add column if not exists tldr text;

-- The check constraint in 0001_slice1_schema.sql was defined inline on
-- the column, so Postgres named it scripts_option_check by default. Drop
-- if it exists; no-op if a previous migration already removed it.
alter table scripts drop constraint if exists scripts_option_check;
