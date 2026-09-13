alter table public.tasks
  add column if not exists completion_follow_up_due_at timestamptz,
  add column if not exists completion_follow_up_sent_at timestamptz;

create index if not exists tasks_due_completion_follow_up_idx
  on public.tasks (completion_follow_up_due_at)
  where status = 'OPEN'
    and alert_acknowledged_at is not null
    and completion_follow_up_sent_at is null
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
  end if;
  return new;
end;
$$;

revoke all on function public.reset_task_alert_cycle_state()
  from public, anon, authenticated;

update public.tasks
set completion_follow_up_due_at = alert_acknowledged_at +
      case when urgent = true then interval '5 minutes' else interval '10 minutes' end,
    completion_follow_up_sent_at = null
where status = 'OPEN'
  and alert_acknowledged_at is not null
  and completion_follow_up_due_at is null
  and (urgent = true or customer_waiting = true);

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
      and t.completion_follow_up_sent_at is null
      and (t.urgent = true or t.customer_waiting = true)
      and t.completion_follow_up_due_at <= clock_timestamp()
    order by t.completion_follow_up_due_at, t.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.tasks t
    set completion_follow_up_sent_at = clock_timestamp(),
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
  'Atomically claims the single completion check due 5 or 10 minutes after acknowledgement.';
