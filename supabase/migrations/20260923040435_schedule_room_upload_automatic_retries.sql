alter table public.manager_room_check_uploads
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempt_at timestamptz;

create index if not exists manager_room_check_uploads_creator_retry_due_idx
  on public.manager_room_check_uploads (created_by_user_id, next_retry_at, created_at)
  where status in ('PENDING', 'UPLOADING');
