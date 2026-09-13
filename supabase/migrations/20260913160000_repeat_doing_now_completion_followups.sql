alter table public.tasks
  add column if not exists completion_follow_up_repeat boolean not null default false;

drop index if exists public.tasks_due_completion_follow_up_idx;

create index tasks_due_completion_follow_up_idx
  on public.tasks (completion_follow_up_due_at)
  where status = 'OPEN'
    and alert_acknowledged_at is not null
    and (completion_follow_up_sent_at is null or completion_follow_up_repeat = true)
    and (urgent = true or customer_waiting = true);

create or replace function public.reset_task_alert_cycle_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.alert_cycle is distinct from old.alert_cycle then
    new.alert_acknowledged_at := null;
    new.alert_acknowledged_by_name := null;
    new.alert_acknowledged_by_email := null;
    new.alert_escalation_count := 0;
    new.alert_last_escalated_at := null;
    new.completion_follow_up_due_at := null;
    new.completion_follow_up_sent_at := null;
    new.completion_follow_up_repeat := false;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_task_alert_cycle_state()
  from public, anon, authenticated;

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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

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

comment on function public.claim_due_acknowledged_task_followups(integer) is
  'Claims the initial completion check and, after Doing Now, repeats it every five minutes until Done.';
