-- Prevent duplicate active room checks and dashboard reminders when multiple
-- supervisors submit the same room at nearly the same time.
create unique index if not exists manager_room_checks_one_active_room_idx
  on public.manager_room_checks (department, room_number)
  where status in ('OPEN', 'PENDING_CHECK');

create unique index if not exists tasks_one_active_manager_room_check_idx
  on public.tasks (department, room, task_text)
  where source_page = 'MANAGER_ROOM_CHECK' and status = 'OPEN';

-- Retention cleanup reads only completed rows and orders by completion time.
create index if not exists manager_room_checks_done_checked_at_idx
  on public.manager_room_checks (department, checked_at, id)
  where status = 'DONE' and checked_at is not null;

-- READY upload rows duplicate the authoritative media row. Remove only rows
-- whose final media record matches the same check and storage object.
delete from public.manager_room_check_uploads as upload
where upload.status = 'READY'
  and exists (
    select 1
    from public.manager_room_check_media as media
    where media.id = upload.id
      and media.check_id = upload.check_id
      and media.media_path = upload.storage_path
  );
