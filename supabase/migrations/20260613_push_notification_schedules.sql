-- Schedule push notifications via pg_cron + pg_net
-- Times are UTC: Lewis is Eastern Time (ET = UTC-4 in summer, UTC-5 in winter)
-- 5:00 AM ET  = 9:00 AM UTC (summer) / 10:00 AM UTC (winter)
-- 12:00 PM ET = 4:00 PM UTC (summer) / 5:00 PM UTC (winter)
-- 9:00 PM ET  = 1:00 AM UTC+1 (summer) / 2:00 AM UTC+1 (winter)
-- Using summer (EDT, UTC-4) times below. Adjust for EST in winter.

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any existing HQ notification jobs
select cron.unschedule(jobname)
from cron.job
where jobname like 'hq-%';

-- Morning alarm: 5:00 AM ET (9:00 AM UTC)
select cron.schedule(
  'hq-morning',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{"type":"morning"}'::jsonb
  );
  $$
);

-- Midday check-in: 12:00 PM ET (4:00 PM UTC)
select cron.schedule(
  'hq-midday',
  '0 16 * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{"type":"midday"}'::jsonb
  );
  $$
);

-- Evening routine: 9:00 PM ET (1:00 AM UTC next day)
select cron.schedule(
  'hq-evening',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{"type":"evening"}'::jsonb
  );
  $$
);

-- Job nudge: 3:00 PM ET (7:00 PM UTC) — "have you applied today?"
select cron.schedule(
  'hq-job-nudge',
  '0 19 * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{"type":"job_nudge"}'::jsonb
  );
  $$
);
