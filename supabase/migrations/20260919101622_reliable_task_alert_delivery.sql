create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.claim_due_task_alert_escalations(
  p_limit integer default 20
)
returns table (
  id uuid,
  task_code text,
  room text,
  department text,
  task_text text,
  chat_id bigint,
  urgent boolean,
  customer_waiting boolean,
  due_at timestamptz,
  alert_cycle integer,
  escalation_number integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select t.id
    from public.tasks t
    where t.status = 'OPEN'
      and t.alert_acknowledged_at is null
      and (t.urgent = true or t.customer_waiting = true)
      and (
        case
          when t.alert_last_escalated_at is not null then t.alert_last_escalated_at
          when t.urgent then coalesce(t.urgent_due_at - interval '5 minutes', t.created_at)
          else coalesce(t.customer_waiting_due_at - interval '10 minutes', t.created_at)
        end
      ) <= clock_timestamp() - interval '1 minute'
    order by coalesce(t.alert_last_escalated_at, t.created_at), t.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.tasks t
    set alert_escalation_count = t.alert_escalation_count + 1,
        alert_last_escalated_at = clock_timestamp(),
        updated_at = clock_timestamp()
    from due
    where t.id = due.id
    returning t.*
  )
  select
    c.id, c.task_code, c.room, c.department, c.task_text, c.chat_id,
    c.urgent, c.customer_waiting,
    case when c.urgent then c.urgent_due_at else c.customer_waiting_due_at end,
    c.alert_cycle, c.alert_escalation_count
  from claimed c;
end;
$$;

revoke all on function public.claim_due_task_alert_escalations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_task_alert_escalations(integer)
  to service_role;

create or replace function public.claim_due_acknowledged_task_followups(
  p_limit integer default 20
)
returns table (
  id uuid,
  task_code text,
  room text,
  department text,
  task_text text,
  chat_id bigint,
  urgent boolean,
  customer_waiting boolean,
  alert_cycle integer,
  alert_acknowledged_at timestamptz,
  completion_follow_up_due_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select t.id
    from public.tasks t
    where t.status = 'OPEN'
      and t.alert_acknowledged_at is not null
      and (t.urgent = true or t.customer_waiting = true)
      and t.completion_follow_up_due_at <= clock_timestamp()
      and (t.completion_follow_up_sent_at is null or t.completion_follow_up_repeat = true)
    order by t.completion_follow_up_due_at, t.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.tasks t
    set completion_follow_up_sent_at = clock_timestamp(),
        completion_follow_up_due_at = case
          when t.completion_follow_up_repeat = true then clock_timestamp() + interval '5 minutes'
          else t.completion_follow_up_due_at
        end,
        updated_at = clock_timestamp()
    from due
    where t.id = due.id
    returning t.*
  )
  select
    c.id, c.task_code, c.room, c.department, c.task_text, c.chat_id,
    c.urgent, c.customer_waiting, c.alert_cycle, c.alert_acknowledged_at,
    c.completion_follow_up_due_at
  from claimed c;
end;
$$;

revoke all on function public.claim_due_acknowledged_task_followups(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_acknowledged_task_followups(integer)
  to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'task-alert-escalations-every-minute';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
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
    ) as request_id;
  $cron$
);

comment on function public.claim_due_task_alert_escalations(integer) is
  'Claims one reminder per minute for open, unacknowledged timed tasks. Execute is restricted to service_role.';

comment on function public.claim_due_acknowledged_task_followups(integer) is
  'Claims due completion checks. Execute is restricted to service_role.';
