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
  with current_collection as (
    select id, cc_no, collection_date, source_service_date
    from public.linen_laundry_collections
    where collection_date = v_report_date
    limit 1
  ), returned_collection as (
    select collection.id, collection.cc_no, collection.collection_date, collection.source_service_date
    from public.linen_laundry_collections collection
    where exists (
      select 1
      from public.linen_laundry_received received
      where received.collection_id = collection.id
        and received.received_date = v_report_date
    )
    order by collection.collection_date desc
    limit 1
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
    where entry.service_date = (select source_service_date from current_collection)
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
    where entry.service_date = (select source_service_date from current_collection)
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
    where bill.collection_id = (select id from current_collection)
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
    where bill.collection_id = (select id from returned_collection)
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
    where received.collection_id = (select id from returned_collection)
      and received.received_date = v_report_date
  )
  select jsonb_build_object(
    'bill_saved_rows', current_bill.saved_rows,
    'bill_expected_rows', 8,
    'bill_saved', current_bill.saved_rows >= 8,
    'bill_cc_no', (select cc_no from current_collection),
    'bill_collection_date', (select collection_date from current_collection),
    'bill_source_service_date', (select source_service_date from current_collection),
    'previous_bill_service_date', (select collection_date from returned_collection),
    'return_service_date', v_report_date,
    'return_cc_no', (select cc_no from returned_collection),
    'return_source_service_date', (select source_service_date from returned_collection),
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

revoke all on function public.get_cc_linked_linen_reconciliation(date)
  from public, anon;
grant execute on function public.get_cc_linked_linen_reconciliation(date)
  to authenticated, service_role;

comment on function public.get_cc_linked_linen_reconciliation(date) is
  'Returns linen use, supplier bill and physical returns linked through a collection CC number rather than inferred only from adjacent dates.';
