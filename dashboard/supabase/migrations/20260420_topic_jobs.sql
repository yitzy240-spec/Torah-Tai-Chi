-- Topic jobs: allow a job to be triggered from a user-supplied topic
-- (freeform text) instead of a pre-approved parsha+script. The video
-- pipeline branches on `kind`: 'parsha' runs the existing flow,
-- 'topic' asks Claude to write a Rav-Eli-voiced draft first and then
-- runs the same clip-plan → generate → stitch pipeline.

alter table jobs
  add column if not exists kind text not null default 'parsha',
  add column if not exists topic text;

alter table jobs
  add constraint jobs_kind_check
  check (kind in ('parsha', 'topic'));

-- parsha jobs still require parsha_id+script_id; topic jobs don't have them.
-- Rather than encoding the XOR in SQL (and risking blocking data import),
-- we drop the NOT NULL constraints and let the application enforce the
-- invariant (compose route always sets kind='topic' + topic, the parsha
-- flow always sets kind='parsha' + parsha_id + script_id).
alter table jobs alter column parsha_id drop not null;
alter table jobs alter column script_id drop not null;

create index if not exists jobs_kind_idx on jobs(kind);
