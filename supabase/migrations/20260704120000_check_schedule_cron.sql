-- Schedule the block-transition check every 5 minutes, aligned with hq-nudge-poller.
-- Block start times and durations always snap to 15-minute increments in the app,
-- so a 10-minutes-before-end warning always lands on a 5-minute boundary.
select cron.unschedule(jobname)
from cron.job
where jobname = 'hq-check-schedule';

select cron.schedule(
  'hq-check-schedule',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/check-schedule',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
