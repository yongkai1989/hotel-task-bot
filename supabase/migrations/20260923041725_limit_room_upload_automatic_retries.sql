alter table public.manager_room_check_uploads
  add column if not exists automatic_retry_count integer not null default 0;

alter table public.manager_room_check_uploads
  drop constraint if exists manager_room_check_uploads_automatic_retry_count_check;

alter table public.manager_room_check_uploads
  add constraint manager_room_check_uploads_automatic_retry_count_check
  check (automatic_retry_count between 0 and 2);
