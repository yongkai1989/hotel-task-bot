alter table public.linen_laundry_collections
  add column if not exists block_no smallint;

update public.linen_laundry_collections
set block_no = 1
where block_no is null;

alter table public.linen_laundry_collections
  drop constraint if exists linen_laundry_collections_collection_date_key;

alter table public.linen_laundry_collections
  alter column block_no set not null;

alter table public.linen_laundry_collections
  drop constraint if exists linen_laundry_collections_block_no_check;

alter table public.linen_laundry_collections
  add constraint linen_laundry_collections_block_no_check
  check (block_no in (1, 2));

create unique index if not exists linen_laundry_collections_date_block_key
  on public.linen_laundry_collections (collection_date, block_no);

insert into public.linen_laundry_collections (
  cc_no,
  collection_date,
  source_service_date,
  block_no,
  is_legacy,
  created_at,
  updated_at
)
select
  'LEGACY-' || to_char(collection.collection_date, 'YYYYMMDD') || '-B2',
  collection.collection_date,
  collection.source_service_date,
  2,
  true,
  collection.created_at,
  now()
from public.linen_laundry_collections collection
where collection.block_no = 1
on conflict (collection_date, block_no) do nothing;

update public.linen_laundry_bill bill
set collection_id = block_2_collection.id
from public.linen_laundry_collections current_collection,
     public.linen_laundry_collections block_2_collection
where bill.collection_id = current_collection.id
  and current_collection.block_no = 1
  and bill.block_no = 2
  and block_2_collection.collection_date = current_collection.collection_date
  and block_2_collection.block_no = 2;

update public.linen_laundry_received received
set collection_id = block_2_collection.id
from public.linen_laundry_collections current_collection,
     public.linen_laundry_collections block_2_collection
where received.collection_id = current_collection.id
  and current_collection.block_no = 1
  and received.block_no = 2
  and block_2_collection.collection_date = current_collection.collection_date
  and block_2_collection.block_no = 2;

create or replace function public.assign_laundry_collection_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_collection_id uuid;
  linked_collection_date date;
  linked_block_no smallint;
begin
  if new.collection_id is not null then
    select collection.collection_date, collection.block_no
    into linked_collection_date, linked_block_no
    from public.linen_laundry_collections collection
    where collection.id = new.collection_id;
  end if;

  if new.collection_id is null
    or linked_collection_date is distinct from new.service_date
    or linked_block_no is distinct from new.block_no then
    select collection.id
    into resolved_collection_id
    from public.linen_laundry_collections collection
    where collection.collection_date = new.service_date
      and collection.block_no = new.block_no;

    if resolved_collection_id is null then
      insert into public.linen_laundry_collections (
        cc_no,
        collection_date,
        source_service_date,
        block_no,
        is_legacy
      )
      values (
        'LEGACY-' || to_char(new.service_date, 'YYYYMMDD') || '-B' || new.block_no,
        new.service_date,
        case
          when new.service_date >= date '2026-09-16' then new.service_date - 1
          else new.service_date
        end,
        new.block_no,
        true
      )
      on conflict (collection_date, block_no) do update
        set updated_at = public.linen_laundry_collections.updated_at
      returning id into resolved_collection_id;
    end if;

    new.collection_id := resolved_collection_id;
  end if;

  if tg_table_name = 'linen_laundry_received' then
    if new.received_date is null then
      new.received_date := (now() at time zone 'Asia/Singapore')::date;
    end if;
  end if;

  return new;
end;
$$;

comment on column public.linen_laundry_collections.block_no is
  'The hotel block covered by this supplier CC number. Each collection date has one CC for Block 1 and one for Block 2.';

create or replace function public.get_cc_linked_linen_reconciliation(
  p_report_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_report_date date := coalesce(
    p_report_date,
    (now() at time zone 'Asia/Singapore')::date
  );
  v_result jsonb;
begin
  with current_collections as (
    select id, cc_no, collection_date, source_service_date, block_no
    from public.linen_laundry_collections
    where collection_date = v_report_date
  ), current_source as (
    select min(source_service_date) source_service_date
    from current_collections
  ), returned_collections as (
    select collection.id, collection.cc_no, collection.collection_date,
      collection.source_service_date, collection.block_no
    from public.linen_laundry_collections collection
    where exists (
      select 1
      from public.linen_laundry_received received
      where received.collection_id = collection.id
        and received.received_date = v_report_date
    )
  ), current_maid as (
    select
      coalesce(sum(entry.bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(entry.bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(entry.pillow_case), 0)::integer pillow_case,
      coalesce(sum(entry.bath_towel), 0)::integer bath_towel,
      coalesce(sum(entry.bath_mat), 0)::integer bath_mat,
      coalesce(sum(entry.duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(entry.duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_room_entry entry
    where entry.service_date = (select source_service_date from current_source)
      and coalesce(entry.is_dnd, false) = false
  ), current_pa as (
    select
      coalesce(sum(entry.bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(entry.bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(entry.pillow_case), 0)::integer pillow_case,
      coalesce(sum(entry.bath_towel), 0)::integer bath_towel,
      coalesce(sum(entry.bath_mat), 0)::integer bath_mat,
      coalesce(sum(entry.duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(entry.duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_pa_entry entry
    where entry.service_date = (select source_service_date from current_source)
  ), current_bill as (
    select
      count(*) filter (where bill.floor_no is not null)::integer saved_rows,
      coalesce(sum(bill.bedsheet_king) filter (where bill.floor_no is not null), 0)::integer bedsheet_king,
      coalesce(sum(bill.bedsheet_single) filter (where bill.floor_no is not null), 0)::integer bedsheet_single,
      coalesce(sum(bill.pillow_case) filter (where bill.floor_no is not null), 0)::integer pillow_case,
      coalesce(sum(bill.bath_towel) filter (where bill.floor_no is not null), 0)::integer bath_towel,
      coalesce(sum(bill.bath_mat) filter (where bill.floor_no is not null), 0)::integer bath_mat,
      coalesce(sum(bill.duvet_cover_king) filter (where bill.floor_no is not null), 0)::integer duvet_cover_king,
      coalesce(sum(bill.duvet_cover_single) filter (where bill.floor_no is not null), 0)::integer duvet_cover_single
    from public.linen_laundry_bill bill
    where bill.collection_id in (select id from current_collections)
  ), returned_bill as (
    select
      coalesce(sum(bill.bedsheet_king) filter (where bill.floor_no is not null), 0)::integer bedsheet_king,
      coalesce(sum(bill.bedsheet_single) filter (where bill.floor_no is not null), 0)::integer bedsheet_single,
      coalesce(sum(bill.pillow_case) filter (where bill.floor_no is not null), 0)::integer pillow_case,
      coalesce(sum(bill.bath_towel) filter (where bill.floor_no is not null), 0)::integer bath_towel,
      coalesce(sum(bill.bath_mat) filter (where bill.floor_no is not null), 0)::integer bath_mat,
      coalesce(sum(bill.duvet_cover_king) filter (where bill.floor_no is not null), 0)::integer duvet_cover_king,
      coalesce(sum(bill.duvet_cover_single) filter (where bill.floor_no is not null), 0)::integer duvet_cover_single
    from public.linen_laundry_bill bill
    where bill.collection_id in (select id from returned_collections)
  ), returned as (
    select
      count(*)::integer saved_rows,
      coalesce(sum(received.bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(received.bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(received.pillow_case), 0)::integer pillow_case,
      coalesce(sum(received.bath_towel), 0)::integer bath_towel,
      coalesce(sum(received.bath_mat), 0)::integer bath_mat,
      coalesce(sum(received.duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(received.duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_laundry_received received
    where received.collection_id in (select id from returned_collections)
      and received.received_date = v_report_date
  )
  select jsonb_build_object(
    'bill_saved_rows', current_bill.saved_rows,
    'bill_expected_rows', 8,
    'bill_saved', current_bill.saved_rows >= 8,
    'bill_cc_no', (
      select string_agg('B' || block_no::text || ': ' || cc_no, ' · ' order by block_no)
      from current_collections
    ),
    'bill_collection_date', (select min(collection_date) from current_collections),
    'bill_source_service_date', (select source_service_date from current_source),
    'previous_bill_service_date', (select min(collection_date) from returned_collections),
    'return_service_date', v_report_date,
    'return_cc_no', (
      select string_agg('B' || block_no::text || ': ' || cc_no, ' · ' order by block_no)
      from returned_collections
    ),
    'return_source_service_date', (select min(source_service_date) from returned_collections),
    'return_saved_rows', returned.saved_rows,
    'return_expected_rows', 2,
    'return_saved', returned.saved_rows >= 2,
    'items', (
      select jsonb_agg(jsonb_build_object(
        'key', item_key,
        'label', label,
        'maid_use', maid_use,
        'pa_use', pa_use,
        'total_use', maid_use + pa_use,
        'in_bill', in_bill,
        'previous_total_use', 0,
        'previous_in_bill', returned_in_bill,
        'returned', returned_qty,
        'previous_bill_minus_return', returned_in_bill - returned_qty,
        'bill_minus_total_use', in_bill - maid_use - pa_use
      ) order by sort_order)
      from (values
        (1, 'bedsheet_king', 'Bedsheet King', current_maid.bedsheet_king, current_pa.bedsheet_king, current_bill.bedsheet_king, returned_bill.bedsheet_king, returned.bedsheet_king),
        (2, 'bedsheet_single', 'Bedsheet Single', current_maid.bedsheet_single, current_pa.bedsheet_single, current_bill.bedsheet_single, returned_bill.bedsheet_single, returned.bedsheet_single),
        (3, 'pillow_case', 'Pillow Case', current_maid.pillow_case, current_pa.pillow_case, current_bill.pillow_case, returned_bill.pillow_case, returned.pillow_case),
        (4, 'bath_towel', 'Bath Towel', current_maid.bath_towel, current_pa.bath_towel, current_bill.bath_towel, returned_bill.bath_towel, returned.bath_towel),
        (5, 'bath_mat', 'Bath Mat', current_maid.bath_mat, current_pa.bath_mat, current_bill.bath_mat, returned_bill.bath_mat, returned.bath_mat),
        (6, 'duvet_cover_king', 'Duvet Cover King', current_maid.duvet_cover_king, current_pa.duvet_cover_king, current_bill.duvet_cover_king, returned_bill.duvet_cover_king, returned.duvet_cover_king),
        (7, 'duvet_cover_single', 'Duvet Cover Single', current_maid.duvet_cover_single, current_pa.duvet_cover_single, current_bill.duvet_cover_single, returned_bill.duvet_cover_single, returned.duvet_cover_single)
      ) metrics(sort_order, item_key, label, maid_use, pa_use, in_bill, returned_in_bill, returned_qty)
    )
  )
  into v_result
  from current_maid, current_pa, current_bill, returned_bill, returned;

  return v_result;
end;
$$;

comment on function public.get_cc_linked_linen_reconciliation(date) is
  'Returns linen use, supplier bills and physical returns linked through separate Block 1 and Block 2 CC numbers.';
