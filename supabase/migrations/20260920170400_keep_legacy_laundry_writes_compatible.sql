create or replace function public.assign_laundry_collection_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_collection_id uuid;
begin
  if new.collection_id is null then
    select collection.id
    into resolved_collection_id
    from public.linen_laundry_collections collection
    where collection.collection_date = new.service_date;

    if resolved_collection_id is null then
      insert into public.linen_laundry_collections (
        cc_no,
        collection_date,
        source_service_date,
        is_legacy
      )
      values (
        'LEGACY-' || to_char(new.service_date, 'YYYYMMDD'),
        new.service_date,
        case
          when new.service_date >= date '2026-09-16' then new.service_date - 1
          else new.service_date
        end,
        true
      )
      on conflict (collection_date) do update
        set updated_at = public.linen_laundry_collections.updated_at
      returning id into resolved_collection_id;
    end if;

    new.collection_id := resolved_collection_id;
  end if;

  if tg_table_name = 'linen_laundry_received'
    and new.received_date is null then
    new.received_date := (now() at time zone 'Asia/Singapore')::date;
  end if;

  return new;
end;
$$;

revoke all on function public.assign_laundry_collection_defaults() from public;
revoke all on function public.assign_laundry_collection_defaults() from anon;
revoke all on function public.assign_laundry_collection_defaults() from authenticated;

drop trigger if exists assign_laundry_bill_collection_defaults
  on public.linen_laundry_bill;
create trigger assign_laundry_bill_collection_defaults
before insert or update on public.linen_laundry_bill
for each row
execute function public.assign_laundry_collection_defaults();

drop trigger if exists assign_laundry_received_collection_defaults
  on public.linen_laundry_received;
create trigger assign_laundry_received_collection_defaults
before insert or update on public.linen_laundry_received
for each row
execute function public.assign_laundry_collection_defaults();

comment on function public.assign_laundry_collection_defaults() is
  'Compatibility bridge for older deployed clients: links omitted collection IDs to the matching date batch until every client runs the CC-aware workflow.';
