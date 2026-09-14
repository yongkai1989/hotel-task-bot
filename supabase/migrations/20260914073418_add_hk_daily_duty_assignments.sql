create table if not exists public.hk_daily_duty_assignments (
  service_date date primary key,
  maid_assignments jsonb not null default '[]'::jsonb,
  supervisor_assignments jsonb not null default '[]'::jsonb,
  linen_controller_staff_ids jsonb not null default '[]'::jsonb,
  special_duties jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hk_daily_duty_maid_assignments_array
    check (jsonb_typeof(maid_assignments) = 'array'),
  constraint hk_daily_duty_supervisor_assignments_array
    check (jsonb_typeof(supervisor_assignments) = 'array'),
  constraint hk_daily_duty_linen_controller_array
    check (jsonb_typeof(linen_controller_staff_ids) = 'array'),
  constraint hk_daily_duty_special_duties_array
    check (jsonb_typeof(special_duties) = 'array')
);

comment on table public.hk_daily_duty_assignments is
  'One compact, versioned housekeeping duty plan per operating date.';

alter table public.hk_daily_duty_assignments enable row level security;

revoke all on table public.hk_daily_duty_assignments from anon, authenticated;
grant select, insert, update on table public.hk_daily_duty_assignments to authenticated;

drop policy if exists "HK schedule users can read duty assignments"
  on public.hk_daily_duty_assignments;
create policy "HK schedule users can read duty assignments"
  on public.hk_daily_duty_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and (
          upper(coalesce(profile.role, '')) in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
          or coalesce(profile.can_access_hk_schedule, false)
        )
    )
  );

drop policy if exists "HK leaders can create duty assignments"
  on public.hk_daily_duty_assignments;
create policy "HK leaders can create duty assignments"
  on public.hk_daily_duty_assignments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and upper(coalesce(profile.role, '')) in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
    )
  );

drop policy if exists "HK leaders can update duty assignments"
  on public.hk_daily_duty_assignments;
create policy "HK leaders can update duty assignments"
  on public.hk_daily_duty_assignments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and upper(coalesce(profile.role, '')) in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
    )
  )
  with check (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and upper(coalesce(profile.role, '')) in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
    )
  );

create or replace function public.save_hk_daily_duty_assignment(
  p_service_date date,
  p_maid_assignments jsonb,
  p_supervisor_assignments jsonb,
  p_linen_controller_staff_ids jsonb,
  p_special_duties jsonb,
  p_expected_version bigint default 0
)
returns table(saved boolean, new_version bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version bigint;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_maid_assignments, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_supervisor_assignments, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_linen_controller_staff_ids, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_special_duties, '[]'::jsonb)) <> 'array' then
    raise exception 'Duty assignment fields must be JSON arrays';
  end if;

  select coalesce(nullif(trim(profile.name), ''), nullif(trim(profile.email), ''), 'Unknown')
  into v_name
  from public.user_profiles profile
  where profile.user_id = auth.uid();

  insert into public.hk_daily_duty_assignments (
    service_date,
    maid_assignments,
    supervisor_assignments,
    linen_controller_staff_ids,
    special_duties,
    version,
    updated_by_user_id,
    updated_by_name,
    updated_at
  ) values (
    p_service_date,
    coalesce(p_maid_assignments, '[]'::jsonb),
    coalesce(p_supervisor_assignments, '[]'::jsonb),
    coalesce(p_linen_controller_staff_ids, '[]'::jsonb),
    coalesce(p_special_duties, '[]'::jsonb),
    1,
    auth.uid(),
    coalesce(v_name, 'Unknown'),
    now()
  )
  on conflict (service_date) do update
  set maid_assignments = excluded.maid_assignments,
      supervisor_assignments = excluded.supervisor_assignments,
      linen_controller_staff_ids = excluded.linen_controller_staff_ids,
      special_duties = excluded.special_duties,
      version = hk_daily_duty_assignments.version + 1,
      updated_by_user_id = auth.uid(),
      updated_by_name = coalesce(v_name, 'Unknown'),
      updated_at = now()
  where hk_daily_duty_assignments.version = p_expected_version
  returning hk_daily_duty_assignments.version into v_version;

  if v_version is null then
    select assignment.version
    into v_version
    from public.hk_daily_duty_assignments assignment
    where assignment.service_date = p_service_date;
    return query select false, coalesce(v_version, 0);
  else
    return query select true, v_version;
  end if;
end;
$$;

revoke all on function public.save_hk_daily_duty_assignment(
  date, jsonb, jsonb, jsonb, jsonb, bigint
) from public, anon;
grant execute on function public.save_hk_daily_duty_assignment(
  date, jsonb, jsonb, jsonb, jsonb, bigint
) to authenticated;
