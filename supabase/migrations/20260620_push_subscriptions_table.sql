-- Push subscriptions table for Web Push notifications
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'lewis',
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(user_id, endpoint)
);

-- Allow the anon key to read/write (HQ uses anon key from frontend)
alter table push_subscriptions enable row level security;

create policy "allow all for lewis" on push_subscriptions
  for all using (user_id = 'lewis') with check (user_id = 'lewis');

grant all on push_subscriptions to anon, authenticated;
