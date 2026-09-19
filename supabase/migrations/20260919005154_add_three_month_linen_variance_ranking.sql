create or replace function public.get_linen_area_variance_top_three_months(
  p_report_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_date date := coalesce(
    p_report_date,
    (now() at time zone 'Asia/Singapore')::date
  );
  v_period_start date := (date_trunc('month', v_report_date) - interval '2 months')::date;
  v_period_end date := (date_trunc('month', v_report_date) + interval '1 month - 1 day')::date;
  v_threshold integer := 2;
  v_top jsonb := '[]'::jsonb;
begin
  if not public.can_view_daily_operations_summary() then
    raise exception 'Management access required';
  end if;

  with maid as (
    select
      service_date,
      block_no,
      floor_no,
      coalesce(sum(bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(pillow_case), 0)::integer pillow_case,
      coalesce(sum(bath_towel), 0)::integer bath_towel,
      coalesce(sum(bath_mat), 0)::integer bath_mat,
      coalesce(sum(duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_room_entry
    where service_date between v_period_start and v_period_end
      and block_no is not null
      and floor_no is not null
      and coalesce(is_dnd, false) = false
    group by service_date, block_no, floor_no
  ), bill as (
    select
      service_date,
      block_no,
      floor_no,
      coalesce(sum(bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(pillow_case), 0)::integer pillow_case,
      coalesce(sum(bath_towel), 0)::integer bath_towel,
      coalesce(sum(bath_mat), 0)::integer bath_mat,
      coalesce(sum(duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_laundry_bill
    where service_date between v_period_start and v_period_end
      and block_no is not null
      and floor_no is not null
    group by service_date, block_no, floor_no
  ), area_days as (
    select
      coalesce(maid.service_date, bill.service_date) service_date,
      coalesce(maid.block_no, bill.block_no) block_no,
      coalesce(maid.floor_no, bill.floor_no) floor_no,
      greatest(
        abs(coalesce(bill.bedsheet_king, 0) - coalesce(maid.bedsheet_king, 0)),
        abs(coalesce(bill.bedsheet_single, 0) - coalesce(maid.bedsheet_single, 0)),
        abs(coalesce(bill.pillow_case, 0) - coalesce(maid.pillow_case, 0)),
        abs(coalesce(bill.bath_towel, 0) - coalesce(maid.bath_towel, 0)),
        abs(coalesce(bill.bath_mat, 0) - coalesce(maid.bath_mat, 0)),
        abs(coalesce(bill.duvet_cover_king, 0) - coalesce(maid.duvet_cover_king, 0)),
        abs(coalesce(bill.duvet_cover_single, 0) - coalesce(maid.duvet_cover_single, 0))
      )::integer largest_abs_difference
    from maid
    full join bill using (service_date, block_no, floor_no)
  ), area_days_count as (
    select block_no, floor_no, count(distinct service_date)::integer days_compared
    from area_days
    group by block_no, floor_no
  ), ranked as (
    select
      area.block_no,
      area.floor_no,
      count(*) filter (where area.largest_abs_difference >= v_threshold)::integer flagged_days,
      count_row.days_compared,
      max(area.service_date) filter (where area.largest_abs_difference >= v_threshold) latest_flag_date,
      max(area.largest_abs_difference)::integer largest_abs_difference
    from area_days area
    join area_days_count count_row using (block_no, floor_no)
    group by area.block_no, area.floor_no, count_row.days_compared
    having bool_or(area.largest_abs_difference >= v_threshold)
  ), numbered as (
    select
      row_number() over (
        order by flagged_days desc, largest_abs_difference desc, block_no, floor_no
      )::integer rank,
      *
    from ranked
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rank', rank,
      'block_no', block_no,
      'floor_no', floor_no,
      'flagged_days', flagged_days,
      'days_compared', days_compared,
      'latest_flag_date', latest_flag_date,
      'largest_abs_difference', largest_abs_difference
    ) order by rank
  ), '[]'::jsonb)
  into v_top
  from numbered
  where rank <= 5;

  return jsonb_build_object(
    'period_start', v_period_start,
    'period_end', v_period_end,
    'threshold', v_threshold,
    'top', v_top
  );
end;
$$;

revoke all on function public.get_linen_area_variance_top_three_months(date)
  from public, anon;
grant execute on function public.get_linen_area_variance_top_three_months(date)
  to authenticated, service_role;

comment on function public.get_linen_area_variance_top_three_months(date) is
  'Returns the five block/levels most frequently above the linen variance threshold across the selected month and two preceding calendar months.';
