create or replace function public.clear_hk_schedule_range(
  p_staff_id uuid,
  p_start_date date,
  p_end_date date,
  p_weekdays integer[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.can_manage_hk_schedule() then
    raise exception 'You do not have access to Housekeeping Schedule';
  end if;

  if p_end_date < p_start_date or p_end_date > p_start_date + 62 then
    raise exception 'Bulk range must be between 1 and 63 days';
  end if;

  if not exists (
    select 1 from public.hk_schedule_staff where id = p_staff_id
  ) then
    raise exception 'Staff record not found';
  end if;

  delete from public.hk_schedule_entries
  where staff_id = p_staff_id
    and schedule_date between p_start_date and p_end_date
    and (
      p_weekdays is null
      or cardinality(p_weekdays) = 0
      or extract(isodow from schedule_date)::integer = any(p_weekdays)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clear_hk_schedule_range(uuid, date, date, integer[]) from public;
revoke all on function public.clear_hk_schedule_range(uuid, date, date, integer[]) from anon;
grant execute on function public.clear_hk_schedule_range(uuid, date, date, integer[]) to authenticated;
grant execute on function public.clear_hk_schedule_range(uuid, date, date, integer[]) to service_role;
