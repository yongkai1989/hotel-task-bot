alter table public.tasks
  add column if not exists alert_acknowledged_at timestamptz,
  add column if not exists alert_acknowledged_by_name text,
  add column if not exists alert_acknowledged_by_email text,
  add column if not exists alert_escalation_count integer not null default 0,
  add column if not exists alert_last_escalated_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_alert_escalation_count_check;

alter table public.tasks
  add constraint tasks_alert_escalation_count_check
  check (alert_escalation_count between 0 and 3);

create index if not exists tasks_due_unacknowledged_alert_idx
  on public.tasks (
    (least(
      coalesce(urgent_due_at, 'infinity'::timestamptz),
      coalesce(customer_waiting_due_at, 'infinity'::timestamptz)
    )),
    alert_last_escalated_at
  )
  where status = 'OPEN'
    and alert_acknowledged_at is null
    and alert_escalation_count < 3
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
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_alert_cycle_state on public.tasks;
create trigger tasks_reset_alert_cycle_state
before update of alert_cycle on public.tasks
for each row execute function public.reset_task_alert_cycle_state();

revoke all on function public.reset_task_alert_cycle_state()
  from public, anon, authenticated;

create or replace function public.claim_due_task_alert_escalations(
  p_limit integer default 5
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
      and t.alert_escalation_count < 3
      and (t.urgent = true or t.customer_waiting = true)
      and (case when t.urgent then t.urgent_due_at else t.customer_waiting_due_at end) <= clock_timestamp()
      and (
        t.alert_last_escalated_at is null
        or t.alert_last_escalated_at <= clock_timestamp() -
          (case when t.urgent then interval '5 minutes' else interval '10 minutes' end)
      )
    order by (case when t.urgent then t.urgent_due_at else t.customer_waiting_due_at end), t.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 10))
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
    c.id,
    c.task_code,
    c.room,
    c.department,
    c.task_text,
    c.chat_id,
    c.urgent,
    c.customer_waiting,
    case when c.urgent then c.urgent_due_at else c.customer_waiting_due_at end,
    c.alert_cycle,
    c.alert_escalation_count
  from claimed c;
end;
$$;

revoke all on function public.claim_due_task_alert_escalations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_task_alert_escalations(integer)
  to service_role;

create or replace function public.get_system_usage_snapshot()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((
      select sum((o.metadata->>'size')::bigint)
      from storage.objects o
      where (o.metadata->>'size') ~ '^[0-9]+$'
    ), 0),
    'storage_objects', (select count(*) from storage.objects),
    'storage_buckets', coalesce((
      select jsonb_agg(to_jsonb(bucket_usage) order by bucket_usage.total_bytes desc)
      from (
        select
          o.bucket_id,
          count(*) as object_count,
          coalesce(sum((o.metadata->>'size')::bigint) filter (
            where (o.metadata->>'size') ~ '^[0-9]+$'
          ), 0) as total_bytes
        from storage.objects o
        group by o.bucket_id
      ) bucket_usage
    ), '[]'::jsonb),
    'largest_tables', coalesce((
      select jsonb_agg(to_jsonb(table_usage) order by table_usage.total_bytes desc)
      from (
        select
          schemaname,
          relname as table_name,
          n_live_tup::bigint as estimated_rows,
          pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) as total_bytes
        from pg_stat_user_tables
        where schemaname = 'public'
        order by total_bytes desc
        limit 8
      ) table_usage
    ), '[]'::jsonb),
    'cleanup_eligible', jsonb_build_object(
      'room_checks', (
        select count(*)
        from public.manager_room_checks c
        where c.status = 'DONE'
          and c.checked_at is not null
          and c.checked_at < clock_timestamp() - interval '15 days'
      ),
      'media_items', (
        select count(*)
        from public.manager_room_check_media m
        join public.manager_room_checks c on c.id = m.check_id
        where c.status = 'DONE'
          and c.checked_at is not null
          and c.checked_at < clock_timestamp() - interval '15 days'
      ),
      'pending_media_protected', (
        select count(*)
        from public.manager_room_check_media m
        join public.manager_room_checks c on c.id = m.check_id
        where c.status <> 'DONE' or c.checked_at is null
      )
    )
  );
$$;

revoke all on function public.get_system_usage_snapshot()
  from public, anon, authenticated;
grant execute on function public.get_system_usage_snapshot()
  to service_role;

comment on function public.claim_due_task_alert_escalations(integer) is
  'Atomically claims up to three timed escalation reminders per unacknowledged alert cycle.';

comment on function public.get_system_usage_snapshot() is
  'Low-cost aggregate database and Storage snapshot for the superuser System Usage page.';
