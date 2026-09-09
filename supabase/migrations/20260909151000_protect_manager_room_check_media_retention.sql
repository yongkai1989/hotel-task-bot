create or replace function public.protect_manager_room_check_media_retention()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.manager_room_checks as room_check
    where room_check.id = old.check_id
      and room_check.status = 'DONE'
      and room_check.checked_at is not null
      and room_check.checked_at <= now() - interval '15 days'
  ) then
    raise exception 'Manager Room Check media can be removed only after the check has been Done for more than 15 days.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_manager_room_check_media_retention_trigger
  on public.manager_room_check_media;

create trigger protect_manager_room_check_media_retention_trigger
before delete on public.manager_room_check_media
for each row execute function public.protect_manager_room_check_media_retention();

revoke all on function public.protect_manager_room_check_media_retention() from public;
