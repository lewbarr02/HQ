-- Every 5 minutes, check for any routine (morning/evening/midday/post-workout/
-- cleaning/golf/car-wash/custom) that was started but not completed within
-- 20 minutes. Fires a push + SMS "not completed" alert, and re-fires on every
-- subsequent tick (i.e. every 5 min) for as long as the routine stays open.
select cron.unschedule(jobname)
from cron.job
where jobname = 'hq-check-routine-timeout';

select cron.schedule(
  'hq-check-routine-timeout',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/check-routine-timeout',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
