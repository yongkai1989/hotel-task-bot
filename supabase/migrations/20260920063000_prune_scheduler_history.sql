do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'prune-scheduler-history-daily'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$$;

select cron.schedule(
  'prune-scheduler-history-daily',
  '15 18 * * *',
  $job$
    delete from cron.job_run_details
    where end_time < now() - interval '7 days';
  $job$
);
