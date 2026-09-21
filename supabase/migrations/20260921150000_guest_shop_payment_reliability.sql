-- Atomic Guest Shop / F&B / Breakfast settlement and low-cost reliability tracking.

begin;

create unique index if not exists guest_shop_orders_payment_reference_uidx
  on public.guest_shop_orders (payment_reference)
  where payment_reference is not null and btrim(payment_reference) <> '';

alter table public.guest_shop_orders
  add column if not exists refund_status text not null default 'NOT_REQUIRED',
  add column if not exists refund_reference text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'guest_shop_orders_refund_status_check'
      and conrelid = 'public.guest_shop_orders'::regclass
  ) then
    alter table public.guest_shop_orders
      add constraint guest_shop_orders_refund_status_check
      check (refund_status in ('NOT_REQUIRED', 'REQUIRED', 'IN_PROGRESS', 'REFUNDED'));
  end if;
end $$;

create table if not exists public.guest_shop_order_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.guest_shop_orders(id) on delete cascade,
  event_type text not null check (event_type in ('STAFF_NOTIFY')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, event_type)
);

create index if not exists guest_shop_order_outbox_pending_idx
  on public.guest_shop_order_outbox (next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED');

alter table public.guest_shop_order_outbox enable row level security;
revoke all on table public.guest_shop_order_outbox from public, anon, authenticated;
grant all on table public.guest_shop_order_outbox to service_role;

create table if not exists public.guest_shop_printer_heartbeats (
  printer_role text primary key check (printer_role in ('BREAKFAST', 'FNB', 'FO')),
  last_seen_at timestamptz not null default now(),
  device_name text,
  printer_name text,
  bridge_version text,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.guest_shop_printer_heartbeats enable row level security;
revoke all on table public.guest_shop_printer_heartbeats from public, anon, authenticated;
grant all on table public.guest_shop_printer_heartbeats to service_role;

create or replace function public.settle_guest_shop_order(
  p_order_id uuid,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.guest_shop_orders%rowtype;
  v_item jsonb;
  v_item_id_text text;
  v_item_id uuid;
  v_quantity integer;
  v_now timestamptz := now();
begin
  select * into v_order
  from public.guest_shop_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('PAID', 'FULFILLED') then return to_jsonb(v_order); end if;
  if v_order.status <> 'PENDING_PAYMENT' then
    raise exception 'Order cannot be settled from status %', v_order.status;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_order.items_json, '[]'::jsonb))
  loop
    v_item_id_text := coalesce(v_item->>'id', '');
    v_quantity := greatest(0, floor(coalesce(nullif(v_item->>'quantity', '')::numeric, 0))::integer);
    if v_quantity = 0 or v_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      continue;
    end if;
    v_item_id := v_item_id_text::uuid;

    update public.guest_shop_items
    set stock = stock - v_quantity,
        out_of_stock = (stock - v_quantity) <= 0,
        updated_at = v_now
    where id = v_item_id and stock >= v_quantity;

    if not found and exists (select 1 from public.guest_shop_items where id = v_item_id) then
      raise exception 'Insufficient stock for item %', coalesce(v_item->>'name', v_item_id_text);
    end if;
  end loop;

  update public.guest_shop_orders
  set status = 'PAID',
      paid_at = coalesce(p_paid_at, v_now),
      updated_at = v_now,
      print_status = case when order_type in ('FNB', 'BREAKFAST') then 'QUEUED' else print_status end,
      print_requested_at = case when order_type in ('FNB', 'BREAKFAST') then v_now else print_requested_at end,
      print_error = case when order_type in ('FNB', 'BREAKFAST') then null else print_error end,
      breakfast_print_status = case when order_type = 'BREAKFAST' then 'QUEUED' else breakfast_print_status end,
      breakfast_print_requested_at = case when order_type = 'BREAKFAST' then v_now else breakfast_print_requested_at end,
      breakfast_print_error = case when order_type = 'BREAKFAST' then null else breakfast_print_error end,
      fnb_print_status = case when order_type = 'FNB' then 'QUEUED' else fnb_print_status end,
      fnb_print_requested_at = case when order_type = 'FNB' then v_now else fnb_print_requested_at end,
      fnb_print_error = case when order_type = 'FNB' then null else fnb_print_error end,
      fo_print_status = case when order_type in ('FNB', 'GUEST_SHOP') then 'QUEUED' else fo_print_status end,
      fo_print_requested_at = case when order_type in ('FNB', 'GUEST_SHOP') then v_now else fo_print_requested_at end,
      fo_print_error = case when order_type in ('FNB', 'GUEST_SHOP') then null else fo_print_error end,
      kitchen_status = case when order_type in ('FNB', 'GUEST_SHOP') then 'PENDING_ACCEPTANCE' else kitchen_status end,
      kitchen_requested_at = case when order_type in ('FNB', 'GUEST_SHOP') then v_now else kitchen_requested_at end,
      kitchen_accept_deadline_at = case when order_type = 'FNB' then v_now + interval '10 minutes' else null end,
      refund_required = false,
      refund_reason = null,
      refund_status = 'NOT_REQUIRED'
  where id = p_order_id
  returning * into v_order;

  if v_order.order_type in ('FNB', 'GUEST_SHOP') then
    insert into public.guest_shop_order_outbox (order_id, event_type)
    values (v_order.id, 'STAFF_NOTIFY')
    on conflict (order_id, event_type) do nothing;
  end if;

  return to_jsonb(v_order);
end;
$$;

revoke all on function public.settle_guest_shop_order(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_guest_shop_order(uuid,timestamptz) to service_role;

create or replace function public.claim_guest_shop_order_outbox(
  p_limit integer default 5,
  p_order_id uuid default null
)
returns setof public.guest_shop_order_outbox
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.guest_shop_order_outbox o
  set status = 'PROCESSING',
      attempts = o.attempts + 1,
      locked_at = now(),
      updated_at = now()
  where o.id in (
    select q.id
    from public.guest_shop_order_outbox q
    where (p_order_id is null or q.order_id = p_order_id)
      and (
        (q.status in ('PENDING', 'FAILED') and q.next_attempt_at <= now())
        or (q.status = 'PROCESSING' and q.locked_at < now() - interval '5 minutes')
      )
    order by q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  returning o.*;
end;
$$;

revoke all on function public.claim_guest_shop_order_outbox(integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_shop_order_outbox(integer,uuid) to service_role;

create or replace function public.expire_unaccepted_fnb_orders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  update public.guest_shop_orders
  set kitchen_status = 'AUTO_REJECTED',
      kitchen_rejected_at = now(),
      kitchen_decision_by = 'Kitchen timeout',
      kitchen_decision_note = 'F&B order was not accepted within 10 minutes.',
      refund_required = true,
      refund_status = 'REQUIRED',
      refund_reason = 'Kitchen did not accept this paid F&B order within 10 minutes.',
      updated_at = now()
  where order_type = 'FNB'
    and status = 'PAID'
    and kitchen_status = 'PENDING_ACCEPTANCE'
    and kitchen_accept_deadline_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_unaccepted_fnb_orders() from public, anon, authenticated;
grant execute on function public.expire_unaccepted_fnb_orders() to service_role;

commit;
