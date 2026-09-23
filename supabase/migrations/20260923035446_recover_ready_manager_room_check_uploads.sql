with public_url_prefix as materialized (
  select left(media_url, length(media_url) - length(media_path)) as value
  from public.manager_room_check_media
  where media_path is not null
    and media_url like '%' || media_path
  order by created_at desc
  limit 1
)
insert into public.manager_room_check_media (
  id,
  check_id,
  media_url,
  media_path,
  media_type,
  caption,
  position,
  completed_at,
  completed_by_name,
  completed_by_email,
  created_at
)
select
  upload.id,
  upload.check_id,
  prefix.value || upload.storage_path,
  upload.storage_path,
  upload.media_type,
  upload.caption,
  upload.position,
  null,
  null,
  null,
  upload.created_at
from public.manager_room_check_uploads as upload
join storage.objects as object
  on object.bucket_id = 'task-images'
 and object.name = upload.storage_path
cross join public_url_prefix as prefix
where upload.status = 'READY'
on conflict (id) do nothing;

delete from public.manager_room_check_uploads as upload
where exists (
  select 1
  from public.manager_room_check_media as media
  where media.id = upload.id
    and media.check_id = upload.check_id
    and media.media_path = upload.storage_path
);
