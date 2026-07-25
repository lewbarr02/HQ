-- Progress photos (front/side/back angles) in Supabase Storage, linked to that
-- day's weigh-in. Path convention: lewis/{date}/{angle}.jpg — date is ISO so
-- files sort chronologically by string order alone, which is what a future
-- time-lapse export needs. This migration only builds storage + the row
-- table + read-ready queries; no video export logic lives here.

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by default; add policies scoped to
-- the 'lewis/' path prefix, mirroring the user_id='lewis' convention used by
-- every other table in this app (there's no real Supabase Auth here).
create policy "lewis can read own progress photos"
  on storage.objects for select
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = 'lewis');

create policy "lewis can upload own progress photos"
  on storage.objects for insert
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = 'lewis');

create policy "lewis can update own progress photos"
  on storage.objects for update
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = 'lewis')
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = 'lewis');

create policy "lewis can delete own progress photos"
  on storage.objects for delete
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = 'lewis');

create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'lewis',
  date date not null,
  angle text not null check (angle in ('front', 'side', 'back')),
  storage_path text not null,
  weight_on_date numeric,           -- pulled from bodyWeightLog[date] at upload time; null if no weigh-in that day
  created_at timestamptz not null default now(),
  unique (user_id, date, angle)     -- one photo per angle per day, upsert-friendly
);

alter table public.progress_photos enable row level security;

create policy "allow all for lewis" on public.progress_photos
  for all using (user_id = 'lewis') with check (user_id = 'lewis');

grant all on public.progress_photos to anon, authenticated, service_role;
