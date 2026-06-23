create table if not exists public.hq_data (
  user_id text not null,
  key text not null,
  value jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table public.hq_data enable row level security;

-- Allow all operations for now (single-user app, no auth)
create policy "allow all" on public.hq_data for all using (true) with check (true);
