alter table public.hk_special_project_tasks
  add column if not exists room_checklist_room_numbers text[];

alter table public.hk_special_project_tasks
  drop constraint if exists hk_special_project_tasks_room_checklist_rooms_valid;

alter table public.hk_special_project_tasks
  add constraint hk_special_project_tasks_room_checklist_rooms_valid
  check (
    (has_room_checklist and (
      room_checklist_room_numbers is null
      or cardinality(room_checklist_room_numbers) > 0
    ))
    or (not has_room_checklist and room_checklist_room_numbers is null)
  );

comment on column public.hk_special_project_tasks.room_checklist_room_numbers is
  'NULL means every active room when has_room_checklist is true; a non-empty array limits each run to those rooms.';

create or replace function public.run_hk_special_project_recurrence()
returns table(
  created_run_id uuid,
  hk_special_project_task_id uuid,
  task_title text,
  run_start_date date,
  due_date date,
  has_room_checklist boolean
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := current_date;
  v_task record;
  v_last_run record;
  v_new_run_id uuid;
  v_next_start_date date;
begin
  update public.hk_special_project_task_runs
  set status = 'OVERDUE', updated_at = now()
  where public.hk_special_project_task_runs.status = 'OPEN'
    and public.hk_special_project_task_runs.due_date < v_today;

  for v_task in
    select *
    from public.hk_special_project_tasks
    where public.hk_special_project_tasks.is_active = true
    order by public.hk_special_project_tasks.created_at asc
  loop
    select * into v_last_run
    from public.hk_special_project_task_runs
    where public.hk_special_project_task_runs.hk_special_project_task_id = v_task.id
    order by public.hk_special_project_task_runs.run_start_date desc,
      public.hk_special_project_task_runs.created_at desc
    limit 1;

    if v_last_run is null then
      insert into public.hk_special_project_task_runs (
        hk_special_project_task_id, run_start_date, due_date, status
      ) values (
        v_task.id, v_today, v_today + v_task.due_in_days, 'OPEN'
      ) returning id into v_new_run_id;

      if v_task.has_room_checklist then
        insert into public.hk_special_project_task_run_rooms (
          hk_special_project_task_run_id, room_number, is_done
        )
        select v_new_run_id, rm.room_number, false
        from public.room_master rm
        where rm.is_active = true
          and (
            v_task.room_checklist_room_numbers is null
            or rm.room_number = any(v_task.room_checklist_room_numbers)
          )
        order by rm.room_number asc;
      end if;

      created_run_id := v_new_run_id;
      hk_special_project_task_id := v_task.id;
      task_title := v_task.title;
      run_start_date := v_today;
      due_date := v_today + v_task.due_in_days;
      has_room_checklist := v_task.has_room_checklist;
      return next;
    else
      if v_last_run.status in ('OVERDUE', 'OPEN') then
        continue;
      end if;

      if v_last_run.status = 'DONE' then
        if v_task.repeat_every_days is null then
          continue;
        end if;

        v_next_start_date := v_last_run.run_start_date + v_task.repeat_every_days;

        if v_today >= v_next_start_date and not exists (
          select 1
          from public.hk_special_project_task_runs r
          where r.hk_special_project_task_id = v_task.id
            and r.run_start_date = v_next_start_date
        ) then
          insert into public.hk_special_project_task_runs (
            hk_special_project_task_id, run_start_date, due_date, status
          ) values (
            v_task.id, v_next_start_date,
            v_next_start_date + v_task.due_in_days, 'OPEN'
          ) returning id into v_new_run_id;

          if v_task.has_room_checklist then
            insert into public.hk_special_project_task_run_rooms (
              hk_special_project_task_run_id, room_number, is_done
            )
            select v_new_run_id, rm.room_number, false
            from public.room_master rm
            where rm.is_active = true
              and (
                v_task.room_checklist_room_numbers is null
                or rm.room_number = any(v_task.room_checklist_room_numbers)
              )
            order by rm.room_number asc;
          end if;

          created_run_id := v_new_run_id;
          hk_special_project_task_id := v_task.id;
          task_title := v_task.title;
          run_start_date := v_next_start_date;
          due_date := v_next_start_date + v_task.due_in_days;
          has_room_checklist := v_task.has_room_checklist;
          return next;
        end if;
      end if;
    end if;
  end loop;

  return;
end;
$function$;
