create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now(),
  sent_via_email boolean not null default false,
  ip text
);

-- Authed users in the dashboard can read; nobody (other than service role)
-- can write directly via the anon key. The website's submit goes through
-- a Next.js server action with the service-role client, bypassing this.
alter table contact_messages enable row level security;
create policy "authed read contact_messages" on contact_messages
  for select using (auth.role() = 'authenticated');

create index if not exists contact_messages_created_at_idx
  on contact_messages(created_at desc);
