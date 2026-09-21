create or replace function public.assign_laundry_collection_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_collection_id uuid;
  linked_collection_date date;
  linked_source_service_date date;
  linked_block_no smallint;
begin
  if new.collection_id is not null then
    select collection.collection_date, collection.source_service_date, collection.block_no
    into linked_collection_date, linked_source_service_date, linked_block_no
    from public.linen_laundry_collections collection
    where collection.id = new.collection_id;
  end if;

  if new.collection_id is null
    or linked_block_no is distinct from new.block_no
    or (
      tg_table_name = 'linen_laundry_bill'
      and linked_source_service_date is distinct from new.service_date
    )
    or (
      tg_table_name = 'linen_laundry_received'
      and linked_collection_date is distinct from new.service_date
    ) then
    select collection.id
    into resolved_collection_id
    from public.linen_laundry_collections collection
    where collection.block_no = new.block_no
      and (
        (tg_table_name = 'linen_laundry_bill' and collection.source_service_date = new.service_date)
        or
        (tg_table_name = 'linen_laundry_received' and collection.collection_date = new.service_date)
      )
    order by collection.collection_date desc
    limit 1;

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
          when tg_table_name = 'linen_laundry_bill' then new.service_date
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

-- Bill service_date now always means the housekeeping day that produced the linen.
update public.linen_laundry_bill bill
set service_date = collection.source_service_date
from public.linen_laundry_collections collection
where collection.id = bill.collection_id
  and bill.service_date is distinct from collection.source_service_date;

create or replace function public.save_laundry_bill_entries(
  p_collection_date date,
  p_source_service_date date,
  p_block1_cc_no text,
  p_block2_cc_no text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_block1_id uuid;
  v_block2_id uuid;
  v_duplicate record;
  v_row_count integer;
  v_valid_count integer;
  v_distinct_count integer;
  v_block1_cc text := upper(trim(coalesce(p_block1_cc_no, '')));
  v_block2_cc text := upper(trim(coalesce(p_block2_cc_no, '')));
begin
  if p_collection_date is null then
    raise exception 'Collection date is required.';
  end if;
  if p_source_service_date is null then
    raise exception 'Linen service date is required.';
  end if;
  if p_source_service_date > p_collection_date then
    raise exception 'Linen service date cannot be after the collection date.';
  end if;
  if v_block1_cc = '' or v_block2_cc = '' then
    raise exception 'A CC No. is required for both Block 1 and Block 2.';
  end if;
  if regexp_replace(lower(v_block1_cc), '[^a-z0-9]+', '', 'g') =
     regexp_replace(lower(v_block2_cc), '[^a-z0-9]+', '', 'g') then
    raise exception 'Block 1 and Block 2 must use different CC numbers.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Laundry bill floor entries are invalid.';
  end if;

  select id into v_block1_id
  from public.linen_laundry_collections
  where collection_date = p_collection_date and block_no = 1
  for update;

  select id into v_block2_id
  from public.linen_laundry_collections
  where collection_date = p_collection_date and block_no = 2
  for update;

  select collection.cc_no, collection.collection_date, collection.block_no
  into v_duplicate
  from public.linen_laundry_collections collection
  where regexp_replace(lower(trim(collection.cc_no)), '[^a-z0-9]+', '', 'g') =
        regexp_replace(lower(v_block1_cc), '[^a-z0-9]+', '', 'g')
    and (v_block1_id is null or collection.id <> v_block1_id)
  limit 1;
  if found then
    raise exception using
      errcode = '23505',
      message = format(
        'CC No. %s is already assigned to Block %s on %s.',
        v_block1_cc,
        v_duplicate.block_no,
        v_duplicate.collection_date
      );
  end if;

  select collection.cc_no, collection.collection_date, collection.block_no
  into v_duplicate
  from public.linen_laundry_collections collection
  where regexp_replace(lower(trim(collection.cc_no)), '[^a-z0-9]+', '', 'g') =
        regexp_replace(lower(v_block2_cc), '[^a-z0-9]+', '', 'g')
    and (v_block2_id is null or collection.id <> v_block2_id)
  limit 1;
  if found then
    raise exception using
      errcode = '23505',
      message = format(
        'CC No. %s is already assigned to Block %s on %s.',
        v_block2_cc,
        v_duplicate.block_no,
        v_duplicate.collection_date
      );
  end if;

  with input_rows as (
    select *
    from jsonb_to_recordset(p_rows) as row_data(
      block_no integer,
      floor_no integer,
      bedsheet_king integer,
      bedsheet_single integer,
      pillow_case integer,
      bath_towel integer,
      bath_mat integer,
      duvet_cover_king integer,
      duvet_cover_single integer
    )
  )
  select
    count(*)::integer,
    count(*) filter (where
      (block_no = 1 and floor_no in (1, 2, 3, 5))
      or (block_no = 2 and floor_no in (3, 5, 6, 7))
    )::integer,
    count(distinct (block_no, floor_no))::integer
  into v_row_count, v_valid_count, v_distinct_count
  from input_rows;

  if v_row_count <> 8 or v_valid_count <> 8 or v_distinct_count <> 8 then
    raise exception 'Exactly one bill entry is required for each of the eight configured floors.';
  end if;

  insert into public.linen_laundry_collections (
    cc_no, collection_date, source_service_date, block_no, is_legacy, updated_at
  ) values (
    v_block1_cc, p_collection_date, p_source_service_date, 1, false, now()
  )
  on conflict (collection_date, block_no) do update set
    cc_no = excluded.cc_no,
    source_service_date = excluded.source_service_date,
    is_legacy = false,
    updated_at = now()
  returning id into v_block1_id;

  insert into public.linen_laundry_collections (
    cc_no, collection_date, source_service_date, block_no, is_legacy, updated_at
  ) values (
    v_block2_cc, p_collection_date, p_source_service_date, 2, false, now()
  )
  on conflict (collection_date, block_no) do update set
    cc_no = excluded.cc_no,
    source_service_date = excluded.source_service_date,
    is_legacy = false,
    updated_at = now()
  returning id into v_block2_id;

  delete from public.linen_laundry_bill
  where collection_id in (v_block1_id, v_block2_id);

  insert into public.linen_laundry_bill (
    collection_id,
    service_date,
    block_no,
    floor_no,
    bedsheet_king,
    bedsheet_single,
    pillow_case,
    bath_towel,
    bath_mat,
    duvet_cover_king,
    duvet_cover_single
  )
  select
    case when row_data.block_no = 1 then v_block1_id else v_block2_id end,
    p_source_service_date,
    row_data.block_no,
    row_data.floor_no,
    greatest(coalesce(row_data.bedsheet_king, 0), 0),
    greatest(coalesce(row_data.bedsheet_single, 0), 0),
    greatest(coalesce(row_data.pillow_case, 0), 0),
    greatest(coalesce(row_data.bath_towel, 0), 0),
    greatest(coalesce(row_data.bath_mat, 0), 0),
    greatest(coalesce(row_data.duvet_cover_king, 0), 0),
    greatest(coalesce(row_data.duvet_cover_single, 0), 0)
  from jsonb_to_recordset(p_rows) as row_data(
    block_no integer,
    floor_no integer,
    bedsheet_king integer,
    bedsheet_single integer,
    pillow_case integer,
    bath_towel integer,
    bath_mat integer,
    duvet_cover_king integer,
    duvet_cover_single integer
  );

  return jsonb_build_object(
    'block1_collection_id', v_block1_id,
    'block2_collection_id', v_block2_id,
    'collection_date', p_collection_date,
    'source_service_date', p_source_service_date
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'One of these CC numbers has already been used for another collection.';
end;
$$;

revoke all on function public.save_laundry_bill_entries(date, date, text, text, jsonb)
  from public, anon;
grant execute on function public.save_laundry_bill_entries(date, date, text, text, jsonb)
  to authenticated;

comment on function public.save_laundry_bill_entries(date, date, text, text, jsonb) is
  'Atomically creates or corrects both block collections and replaces their eight floor bill entries.';

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
    where source_service_date = v_report_date
  ), returned_collections as (
    select id, cc_no, collection_date, source_service_date, block_no
    from public.linen_laundry_collections
    where collection_date = v_report_date - 1
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
    where entry.service_date = v_report_date
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
    where entry.service_date = v_report_date
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
      and bill.service_date = v_report_date
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
      count(*) filter (where
        coalesce(received.bedsheet_king, 0)
        + coalesce(received.bedsheet_single, 0)
        + coalesce(received.pillow_case, 0)
        + coalesce(received.bath_towel, 0)
        + coalesce(received.bath_mat, 0)
        + coalesce(received.duvet_cover_king, 0)
        + coalesce(received.duvet_cover_single, 0) > 0
      )::integer saved_rows,
      coalesce(sum(received.bedsheet_king), 0)::integer bedsheet_king,
      coalesce(sum(received.bedsheet_single), 0)::integer bedsheet_single,
      coalesce(sum(received.pillow_case), 0)::integer pillow_case,
      coalesce(sum(received.bath_towel), 0)::integer bath_towel,
      coalesce(sum(received.bath_mat), 0)::integer bath_mat,
      coalesce(sum(received.duvet_cover_king), 0)::integer duvet_cover_king,
      coalesce(sum(received.duvet_cover_single), 0)::integer duvet_cover_single
    from public.linen_laundry_received received
    where received.collection_id in (select id from returned_collections)
  )
  select jsonb_build_object(
    'bill_saved_rows', current_bill.saved_rows,
    'bill_expected_rows', 8,
    'bill_saved', current_bill.saved_rows >= 8,
    'bill_cc_no', (
      select string_agg('B' || block_no::text || ': ' || cc_no, ' · ' order by collection_date, block_no)
      from current_collections
    ),
    'bill_collection_date', (select min(collection_date) from current_collections),
    'bill_source_service_date', v_report_date,
    'previous_bill_service_date', v_report_date - 1,
    'return_collection_date', v_report_date - 1,
    'return_service_date', v_report_date,
    'return_cc_no', (
      select string_agg('B' || block_no::text || ': ' || cc_no, ' · ' order by block_no)
      from returned_collections
    ),
    'return_source_service_date', (select min(source_service_date) from returned_collections),
    'return_outstanding_cc_no', (
      select string_agg('B' || collection.block_no::text || ': ' || collection.cc_no, ' · ' order by collection.block_no)
      from returned_collections collection
      where not exists (
        select 1
        from public.linen_laundry_received received
        where received.collection_id = collection.id
          and (
            coalesce(received.bedsheet_king, 0)
            + coalesce(received.bedsheet_single, 0)
            + coalesce(received.pillow_case, 0)
            + coalesce(received.bath_towel, 0)
            + coalesce(received.bath_mat, 0)
            + coalesce(received.duvet_cover_king, 0)
            + coalesce(received.duvet_cover_single, 0)
          ) > 0
      )
    ),
    'return_saved_rows', returned.saved_rows,
    'return_expected_rows', 2,
    'return_saved', returned.saved_rows >= 2
      and (select count(*) from returned_collections) >= 2,
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
  'Compares use and bill by linen service date, and returns against the previous collection date through matching block CC numbers.';
