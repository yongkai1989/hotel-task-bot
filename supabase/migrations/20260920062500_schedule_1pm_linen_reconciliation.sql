do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'linen-reconciliation-1pm-singapore'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$$;

select cron.schedule(
  'linen-reconciliation-1pm-singapore',
  '0 5 * * *',
  $job$
    select net.http_post(
      url := 'https://crown.hotelhallmark.com/api/operational-reminders?kind=linen-reconciliation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'task_alert_scheduler_token'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    ) as request_id;
  $job$
);
