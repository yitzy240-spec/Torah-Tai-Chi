-- Flag for QA seed rows. Production code must filter these out of
-- any public-facing query. Teardown deletes all rows with qa_seed=true.
--
-- NOTE: The original QA plan called for tagging `articles` as well, but
-- articles were migrated out of Supabase to Storyblok in 20260417_drop_cms_tables.sql.
-- Storyblok QA isolation will be handled separately (via Storyblok tags / a
-- dedicated QA folder), not via this column.
alter table public.videos add column if not exists qa_seed boolean not null default false;
alter table public.posts  add column if not exists qa_seed boolean not null default false;

create index if not exists videos_qa_seed_idx on public.videos(qa_seed) where qa_seed = true;
create index if not exists posts_qa_seed_idx  on public.posts(qa_seed)  where qa_seed = true;

comment on column public.videos.qa_seed is 'QA test seed row; must be filtered out of public queries and wiped by global-teardown.';
comment on column public.posts.qa_seed  is 'QA test seed row; same rules as videos.qa_seed.';
