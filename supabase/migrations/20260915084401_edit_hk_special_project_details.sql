create or replace function public.update_hk_special_project_task(
  p_task_id uuid,
  p_run_id uuid,
  p_title text,
  p_start_date date,
  p_due_date date,
  p_room_numbers text[]
)
returns integer
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_requested_rooms text[];
  v_valid_rooms text[];
  v_run_status text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = auth.uid()
      and (
        upper(coalesce(profile.role, '')) = 'SUPERUSER'
        or lower(coalesce(profile.email, '')) = any(array[
          'hksup1@hotelhallmark.com',
          'hksup2@hotelhallmark.com',
          'hksup3@hotelhallmark.com'
        ])
      )
  ) then
    raise exception 'You do not have permission to edit HK Special Projects';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Project name is required';
  end if;

  if p_start_date is null or p_due_date is null then
    raise exception 'Start date and due date are required';
  end if;

  if p_due_date < p_start_date then
    raise exception 'Due date cannot be earlier than the start date';
  end if;

  select run.status
  into v_run_status
  from public.hk_special_project_task_runs run
  where run.id = p_run_id
    and run.hk_special_project_task_id = p_task_id
  for update;

  if not found then
    raise exception 'HK Special Project run not found';
  end if;

  if v_run_status = 'DONE' then
    raise exception 'Reopen this task before editing it';
  end if;

  select array_agg(distinct btrim(room_number) order by btrim(room_number))
  into v_requested_rooms
  from unnest(coalesce(p_room_numbers, array[]::text[])) selected(room_number)
  where btrim(room_number) <> '';

  if coalesce(cardinality(v_requested_rooms), 0) = 0 then
    raise exception 'Choose at least one room';
  end if;

  select array_agg(room.room_number order by room.room_number)
  into v_valid_rooms
  from public.room_master room
  where room.is_active = true
    and room.room_number = any(v_requested_rooms);

  if coalesce(cardinality(v_valid_rooms), 0) <> cardinality(v_requested_rooms) then
    raise exception 'One or more selected rooms are invalid or inactive';
  end if;

  update public.hk_special_project_tasks
  set title = btrim(p_title),
      due_in_days = p_due_date - p_start_date,
      has_room_checklist = true,
      room_checklist_room_numbers = v_valid_rooms,
      updated_at = now()
  where id = p_task_id
    and is_active = true;

  if not found then
    raise exception 'HK Special Project task not found';
  end if;

  update public.hk_special_project_task_runs
  set run_start_date = p_start_date,
      due_date = p_due_date,
      status = case when p_due_date < current_date then 'OVERDUE' else 'OPEN' end,
      updated_at = now()
  where id = p_run_id;

  delete from public.hk_special_project_task_run_rooms room
  where room.hk_special_project_task_run_id = p_run_id
    and not (room.room_number = any(v_valid_rooms));

  insert into public.hk_special_project_task_run_rooms (
    hk_special_project_task_run_id,
    room_number,
    is_done
  )
  select p_run_id, room_number, false
  from unnest(v_valid_rooms) room_number
  on conflict (hk_special_project_task_run_id, room_number) do nothing;

  return cardinality(v_valid_rooms);
end;
$function$;

revoke all on function public.update_hk_special_project_task(uuid, uuid, text, date, date, text[]) from public;
revoke all on function public.update_hk_special_project_task(uuid, uuid, text, date, date, text[]) from anon;
grant execute on function public.update_hk_special_project_task(uuid, uuid, text, date, date, text[]) to authenticated;
