drop policy if exists manager_room_check_uploads_creator_cancel_failed
  on public.manager_room_check_uploads;

create policy manager_room_check_uploads_creator_cancel_failed
  on public.manager_room_check_uploads
  for delete
  to authenticated
  using (
    status = 'FAILED'
    and created_by_user_id = (select auth.uid())
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
  );
