alter table public.tasks
  drop constraint if exists tasks_alert_escalation_count_check;

alter table public.tasks
  add constraint tasks_alert_escalation_count_check
  check (alert_escalation_count >= 0);

drop index if exists public.tasks_due_unacknowledged_alert_idx;

create index tasks_due_unacknowledged_alert_idx
  on public.tasks (alert_last_escalated_at, created_at)
  where status = 'OPEN'
    and alert_acknowledged_at is null
    and (urgent = true or customer_waiting = true);

create or replace function public.create_task_alert_recipients()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'OPEN' and (new.customer_waiting = true or new.urgent = true) then
    insert into public.task_alert_recipients (
      task_id, alert_cycle, user_id, user_name, user_email
    )
    select
      new.id,
      greatest(coalesce(new.alert_cycle, 1), 1),
      profile.user_id,
      coalesce(nullif(trim(profile.name), ''), profile.email),
      lower(trim(profile.email))
    from public.user_profiles profile
    where (
      upper(trim(new.department)) = 'HK'
      and upper(trim(coalesce(profile.role, ''))) in ('HK', 'SUPERVISOR')
      and coalesce(profile.can_access_chambermaid_entry, false) = true
    ) or (
      upper(trim(new.department)) = 'MT'
      and upper(trim(coalesce(profile.role, ''))) = 'MT'
    )
    on conflict (task_id, alert_cycle, user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.create_task_alert_recipients()
  from public, anon, authenticated;

delete from public.task_alert_recipients recipient
using public.tasks task, public.user_profiles profile
where recipient.task_id = task.id
  and recipient.user_id = profile.user_id
  and recipient.alert_cycle = greatest(coalesce(task.alert_cycle, 1), 1)
  and task.status = 'OPEN'
  and (task.customer_waiting = true or task.urgent = true)
  and not (
    (upper(trim(task.department)) = 'HK'
      and upper(trim(coalesce(profile.role, ''))) in ('HK', 'SUPERVISOR')
      and coalesce(profile.can_access_chambermaid_entry, false) = true)
    or
    (upper(trim(task.department)) = 'MT'
      and upper(trim(coalesce(profile.role, ''))) = 'MT')
  );

insert into public.task_alert_recipients (
  task_id, alert_cycle, user_id, user_name, user_email
)
select
  task.id,
  greatest(coalesce(task.alert_cycle, 1), 1),
  profile.user_id,
  coalesce(nullif(trim(profile.name), ''), profile.email),
  lower(trim(profile.email))
from public.tasks task
join public.user_profiles profile on (
  (upper(trim(task.department)) = 'HK'
    and upper(trim(coalesce(profile.role, ''))) in ('HK', 'SUPERVISOR')
    and coalesce(profile.can_access_chambermaid_entry, false) = true)
  or
  (upper(trim(task.department)) = 'MT'
    and upper(trim(coalesce(profile.role, ''))) = 'MT')
)
where task.status = 'OPEN'
  and task.alert_acknowledged_at is null
  and (task.customer_waiting = true or task.urgent = true)
on conflict (task_id, alert_cycle, user_id) do nothing;

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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

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

comment on function public.claim_due_task_alert_escalations(integer) is
  'Atomically claims one reminder per minute for every open, unacknowledged urgent or customer-waiting task.';
