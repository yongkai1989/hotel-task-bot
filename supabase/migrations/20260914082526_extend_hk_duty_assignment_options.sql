alter table public.hk_daily_duty_assignments
  add column if not exists part_time_maids jsonb not null default '[]'::jsonb,
  add column if not exists special_priority_presets jsonb not null
    default '["Room Fixtures", "Bathroom Deep Clean", "Guest Amenities"]'::jsonb;

alter table public.hk_daily_duty_assignments
  add constraint hk_daily_duty_part_time_maids_array
    check (jsonb_typeof(part_time_maids) = 'array'),
  add constraint hk_daily_duty_special_priority_presets_array
    check (jsonb_typeof(special_priority_presets) = 'array');

create or replace function public.save_hk_daily_duty_assignment(
  p_service_date date,
  p_maid_assignments jsonb,
  p_supervisor_assignments jsonb,
  p_linen_controller_staff_ids jsonb,
  p_special_duties jsonb,
  p_part_time_maids jsonb,
  p_special_priority_presets jsonb,
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
    or jsonb_typeof(coalesce(p_special_duties, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_part_time_maids, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_special_priority_presets, '[]'::jsonb)) <> 'array' then
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
    part_time_maids,
    special_priority_presets,
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
    coalesce(p_part_time_maids, '[]'::jsonb),
    coalesce(p_special_priority_presets, '[]'::jsonb),
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
      part_time_maids = excluded.part_time_maids,
      special_priority_presets = excluded.special_priority_presets,
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
  date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint
) from public, anon;
grant execute on function public.save_hk_daily_duty_assignment(
  date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint
) to authenticated;
