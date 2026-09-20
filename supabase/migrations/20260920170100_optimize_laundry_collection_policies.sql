drop policy if exists "Laundry collections write" on public.linen_laundry_collections;

create policy "Laundry collections insert"
  on public.linen_laundry_collections
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and (
          profile.role in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
          or profile.can_access_linen_admin = true
          or profile.can_access_laundry_received = true
          or lower(profile.email) = 'laundry@hotelhallmark.com'
        )
    )
  );

create policy "Laundry collections update"
  on public.linen_laundry_collections
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and (
          profile.role in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
          or profile.can_access_linen_admin = true
          or profile.can_access_laundry_received = true
          or lower(profile.email) = 'laundry@hotelhallmark.com'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and (
          profile.role in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
          or profile.can_access_linen_admin = true
          or profile.can_access_laundry_received = true
          or lower(profile.email) = 'laundry@hotelhallmark.com'
        )
    )
  );

create policy "Laundry collections delete"
  on public.linen_laundry_collections
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and (
          profile.role in ('SUPERUSER', 'MANAGER', 'SUPERVISOR')
          or profile.can_access_linen_admin = true
          or profile.can_access_laundry_received = true
          or lower(profile.email) = 'laundry@hotelhallmark.com'
        )
    )
  );
