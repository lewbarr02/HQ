-- Flow State sessions, moved out of the localStorage `flowLog` blob so the
-- flow-checkin (SMS "Still in it?") and flow-reply (Twilio inbound) edge
-- functions can read/write them server-side.
--
-- RLS follows the current pre-lockdown pattern (open to anon for user_id
-- 'lewis', like progress_milestones). The locked version lives in
-- supabase/lockdown/flow_sessions.sql — apply it with the rest of the lockdown.

create table if not exists public.flow_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'lewis',
  morning_routine_completed_at timestamptz,
  started_at timestamptz not null,
  ended_at timestamptz,
  end_source text check (end_source in ('reply', 'manual', 'auto_close')),
  is_first_of_day boolean not null default false,
  last_check_at timestamptz,
  next_check_at timestamptz,
  unanswered_count int not null default 0,
  awaiting_reply boolean not null default false,
  end_quality smallint check (end_quality between 1 and 5),
  legacy_id text unique, -- id from the old localStorage flowLog, so the one-time import can't duplicate
  created_at timestamptz not null default now()
);

-- Only one active session at a time.
create unique index if not exists flow_sessions_one_active
  on public.flow_sessions (user_id) where ended_at is null;

create index if not exists flow_sessions_started_at
  on public.flow_sessions (user_id, started_at desc);

-- is_first_of_day is computed server-side (America/New_York calendar day) so
-- it's race-free across devices; next_check_at defaults to start + 45 min.
create or replace function public.flow_sessions_before_insert()
returns trigger
language plpgsql
volatile
set search_path = public
as $$
begin
  new.is_first_of_day := not exists (
    select 1 from public.flow_sessions f
    where f.user_id = new.user_id
      and (f.started_at at time zone 'America/New_York')::date
        = (new.started_at at time zone 'America/New_York')::date
  );
  if new.next_check_at is null then
    new.next_check_at := new.started_at + interval '45 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists flow_sessions_before_insert on public.flow_sessions;
create trigger flow_sessions_before_insert
  before insert on public.flow_sessions
  for each row execute function public.flow_sessions_before_insert();

alter table public.flow_sessions enable row level security;

drop policy if exists "allow all for lewis" on public.flow_sessions;
create policy "allow all for lewis" on public.flow_sessions
  for all using (user_id = 'lewis') with check (user_id = 'lewis');

grant all on public.flow_sessions to anon, authenticated, service_role;

-- Every 5 minutes: send "Still in it?" check-ins / auto-close after 2 misses.
-- The x-hq-secret header is read from Vault (secret name 'hq_internal_secret')
-- so the value never lands in this public repo.
select cron.unschedule(jobname)
from cron.job
where jobname = 'hq-flow-checkin';

select cron.schedule(
  'hq-flow-checkin',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/flow-checkin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4',
      'apikey', 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4',
      'x-hq-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hq_internal_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
