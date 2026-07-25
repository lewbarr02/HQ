-- Cloud-syncs the Starting Point / Current / Goal photo triptych (Fitness →
-- Progress), which previously stored image bytes only in localStorage per
-- device. Reuses the progress-photos bucket (its RLS already covers any
-- lewis/ path) under lewis/milestones/{slot}.jpg — one photo per slot,
-- overwritten in place, not a dated series like the front/side/back angles.

create table if not exists public.progress_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'lewis',
  slot text not null check (slot in ('start', 'current', 'goal')),
  date date not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slot)
);

alter table public.progress_milestones enable row level security;

create policy "allow all for lewis" on public.progress_milestones
  for all using (user_id = 'lewis') with check (user_id = 'lewis');

grant all on public.progress_milestones to anon, authenticated, service_role;
