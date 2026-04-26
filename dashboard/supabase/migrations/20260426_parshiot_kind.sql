-- Holidays as first-class rows in parshiot. Same scripts/jobs/clip_plans
-- pipeline; just a 'kind' column to distinguish (and to filter the
-- 54-parsha grid vs. a Holidays grid in the dashboard).
alter table parshiot
  add column if not exists kind text not null default 'parsha';

alter table parshiot
  drop constraint if exists parshiot_kind_check;

alter table parshiot
  add constraint parshiot_kind_check check (kind in ('parsha', 'holiday'));

create index if not exists parshiot_kind_idx on parshiot(kind);

-- Holidays don't have a Torah-reading order. Allow null `order` so
-- holidays can coexist without faking integers. Existing parsha rows
-- keep their order values unchanged.
alter table parshiot alter column "order" drop not null;
