-- User-editable nudges table, replacing the hardcoded per-nudge cron jobs
create table if not exists public.nudges (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'lewis',
  emoji text default '🔔',
  title text not null,
  body text not null,
  time text not null,              -- 'HH:MM' 24-hour, America/New_York local time
  days smallint[] not null default '{0,1,2,3,4,5,6}',  -- 0=Sun .. 6=Sat (JS getDay convention)
  require_interaction boolean not null default false,
  active boolean not null default true,
  last_sent_date text,             -- 'YYYY-MM-DD' in America/New_York, prevents duplicate sends
  created_at timestamptz default now()
);

alter table public.nudges enable row level security;

create policy "allow all for lewis" on public.nudges
  for all using (user_id = 'lewis') with check (user_id = 'lewis');

grant all on public.nudges to anon, authenticated, service_role;

-- Seed the 4 static-content nudges that previously lived as separate pg_cron jobs.
-- (Momentum check is excluded — its content is generated fresh each run, not static text,
-- so it keeps its own dedicated pg_cron job / edge function.)
insert into public.nudges (emoji, title, body, time, days, require_interaction) values
  ('🌅', 'Good morning, Lewis!', 'Time to start your morning routine. Let''s crush today.', '05:00', '{0,1,2,3,4,5,6}', true),
  ('☀️', 'Midday check-in', 'Quick pulse — how''s the day going? Hit your job app yet?', '12:00', '{0,1,2,3,4,5,6}', false),
  ('💼', 'Job search check-in', 'Have you applied today? Keep the streak alive — the Moonshot can wait 10 minutes.', '15:00', '{0,1,2,3,4,5,6}', true),
  ('🌙', 'Evening routine time', 'Wind down and get that CPAP on. Tomorrow starts tonight.', '21:00', '{0,1,2,3,4,5,6}', true)
on conflict do nothing;

-- Remove the old static-content cron jobs (morning/midday/evening/job-nudge) — replaced by
-- the single hq-nudge-poller job below, which reads this table every 5 minutes.
-- hq-momentum-check is left untouched.
select cron.unschedule(jobname)
from cron.job
where jobname in ('hq-morning', 'hq-midday', 'hq-evening', 'hq-job-nudge');

select cron.schedule(
  'hq-nudge-poller',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/run-nudges',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
