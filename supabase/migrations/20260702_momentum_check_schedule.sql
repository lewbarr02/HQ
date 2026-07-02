-- Schedule the daily momentum-warning check via pg_cron + pg_net
-- 7:00 PM ET = 11:00 PM UTC (summer, EDT UTC-4). Adjust for EST in winter.

select cron.unschedule(jobname)
from cron.job
where jobname = 'hq-momentum-check';

select cron.schedule(
  'hq-momentum-check',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://bfgybytjjubdnciraksj.supabase.co/functions/v1/check-momentum',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4","apikey":"sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
