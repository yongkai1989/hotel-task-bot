drop policy if exists manager_room_check_uploads_creator_cleanup_completed
  on public.manager_room_check_uploads;

create policy manager_room_check_uploads_creator_cleanup_completed
  on public.manager_room_check_uploads
  for delete
  to authenticated
  using (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.manager_room_checks c
      join public.user_profiles p
        on p.user_id = (select auth.uid())
      where c.id = manager_room_check_uploads.check_id
        and (
          p.role = 'SUPERUSER'
          or (c.department = 'MT' and p.can_access_maintenance_manager_room_check = true)
          or (c.department = 'HK' and p.can_access_hk_manager_room_check = true)
        )
    )
    and exists (
      select 1
      from public.manager_room_check_media m
      where m.id = manager_room_check_uploads.id
        and m.check_id = manager_room_check_uploads.check_id
        and m.media_path = manager_room_check_uploads.storage_path
    )
  );

-- A completed media row is authoritative. Old queue rows were left behind
-- because their creator could only delete rows after they had failed.
delete from public.manager_room_check_uploads as upload
where exists (
  select 1
  from public.manager_room_check_media as media
  where media.id = upload.id
    and media.check_id = upload.check_id
    and media.media_path = upload.storage_path
);
