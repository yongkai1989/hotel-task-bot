create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Keep the one-minute alert guarantee, but do not wake the application when
-- neither an acknowledgement reminder nor a completion follow-up is due.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'task-alert-escalations-every-minute'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$$;

select cron.schedule(
  'task-alert-escalations-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://crown.hotelhallmark.com/api/internal/task-alert-escalations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'task_alert_scheduler_token'
          limit 1
        )
      ),
      body := jsonb_build_object('scheduled_at', clock_timestamp()),
      timeout_milliseconds := 20000
    ) as request_id
    where exists (
      select 1
      from public.tasks t
      where t.status = 'OPEN'
        and (t.urgent = true or t.customer_waiting = true)
        and (
          (
            t.alert_acknowledged_at is null
            and (
              case
                when t.alert_last_escalated_at is not null then t.alert_last_escalated_at
                when t.urgent then coalesce(t.urgent_due_at - interval '5 minutes', t.created_at)
                else coalesce(t.customer_waiting_due_at - interval '10 minutes', t.created_at)
              end
            ) <= clock_timestamp() - interval '1 minute'
          )
          or
          (
            t.alert_acknowledged_at is not null
            and t.completion_follow_up_due_at <= clock_timestamp()
            and (t.completion_follow_up_sent_at is null or t.completion_follow_up_repeat = true)
          )
        )
      limit 1
    );
  $cron$
);

-- Run existing retention rules even when nobody opens the related pages.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'storage-maintenance-daily'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$$;

select cron.schedule(
  'storage-maintenance-daily',
  '30 18 * * *',
  $cron$
    select net.http_post(
      url := 'https://crown.hotelhallmark.com/api/internal/storage-maintenance',
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
      timeout_milliseconds := 25000
    ) as request_id;
  $cron$
);

-- Two days is enough for diagnosis and prevents a minute-by-minute scheduler
-- from accumulating a large history table on the Nano database.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'prune-scheduler-history-daily'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$$;

select cron.schedule(
  'prune-scheduler-history-daily',
  '15 18 * * *',
  $cron$
    delete from cron.job_run_details
    where end_time < now() - interval '2 days';
  $cron$
);

create or replace function public.get_system_stability_snapshot()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'connections', (
      select count(*)
      from pg_stat_activity
      where datname = current_database()
    ),
    'scheduler', jsonb_build_object(
      'runs_24h', (
        select count(*) from cron.job_run_details
        where start_time >= clock_timestamp() - interval '24 hours'
      ),
      'failures_24h', (
        select count(*) from cron.job_run_details
        where start_time >= clock_timestamp() - interval '24 hours'
          and status <> 'succeeded'
      ),
      'latest_failure', (
        select max(start_time) from cron.job_run_details
        where status <> 'succeeded'
      ),
      'retained_runs', (select count(*) from cron.job_run_details)
    ),
    'storage_growth_30d_bytes', coalesce((
      select sum((metadata->>'size')::bigint)
      from storage.objects
      where created_at >= clock_timestamp() - interval '30 days'
        and (metadata->>'size') ~ '^[0-9]+$'
    ), 0),
    'cleanup_eligible', jsonb_build_object(
      'completed_task_media', (
        select count(*)
        from public.task_images ti
        join public.tasks t on t.id = ti.task_id
        where t.status = 'DONE'
          and t.done_at is not null
          and t.done_at < clock_timestamp() - interval '90 days'
          and ti.image_url like '%/storage/v1/object/public/task-images/task-media/%'
      ),
      'chiller_submissions', (
        select count(*)
        from public.chiller_cleaning_submissions
        where week_start < (current_date - interval '4 months')::date
      )
    )
  );
$$;

revoke all on function public.get_system_stability_snapshot()
  from public, anon, authenticated;
grant execute on function public.get_system_stability_snapshot()
  to service_role;

comment on function public.get_system_stability_snapshot() is
  'Small superuser-only health snapshot for scheduler, connections, storage growth, and retention eligibility.';
