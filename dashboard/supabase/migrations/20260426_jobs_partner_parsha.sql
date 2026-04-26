alter table jobs
  add column if not exists partner_parsha_id uuid references parshiot(id)
    on delete set null;

create index if not exists jobs_partner_parsha_id_idx
  on jobs(partner_parsha_id) where partner_parsha_id is not null;
