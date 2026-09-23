create sequence if not exists public.proforma_invoice_number_seq start with 1;

create table if not exists public.proforma_clients (
  id bigint generated always as identity primary key,
  company_name text not null,
  address text not null default '',
  contact_person text not null,
  contact_number text not null,
  active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proforma_clients_company_name_not_blank check (length(btrim(company_name)) > 0),
  constraint proforma_clients_contact_person_not_blank check (length(btrim(contact_person)) > 0)
);

create table if not exists public.proforma_invoices (
  id bigint generated always as identity primary key,
  invoice_number text not null unique default (
    'PI-' ||
    to_char(current_timestamp at time zone 'Asia/Singapore', 'YYYY') || '-' ||
    lpad(nextval('public.proforma_invoice_number_seq')::text, 5, '0')
  ),
  client_id bigint not null references public.proforma_clients(id) on delete restrict,
  client_company_name text not null,
  client_address text not null default '',
  client_contact_person text not null,
  client_contact_number text not null,
  proforma_date date not null default ((current_timestamp at time zone 'Asia/Singapore')::date),
  check_in_date date not null,
  check_out_date date not null,
  stay_nights integer not null,
  tour_code text,
  line_items jsonb not null default '[]'::jsonb,
  total_room_count integer not null default 0,
  total_room_nights integer not null default 0,
  grand_total numeric(12,2) not null default 0,
  deposit_paid numeric(12,2) not null default 0,
  payments_received numeric(12,2) not null default 0,
  balance_outstanding numeric(12,2) generated always as (
    greatest(grand_total - deposit_paid - payments_received, 0::numeric)
  ) stored,
  status text not null default 'ISSUED',
  amendment_no integer not null default 0,
  amendment_date date,
  amendment_note text,
  checked_in_at timestamptz,
  declined_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proforma_invoices_dates_valid check (check_out_date > check_in_date),
  constraint proforma_invoices_stay_nights_positive check (stay_nights > 0),
  constraint proforma_invoices_room_counts_valid check (total_room_count >= 0 and total_room_nights >= 0),
  constraint proforma_invoices_totals_valid check (
    grand_total >= 0 and deposit_paid >= 0 and payments_received >= 0
    and deposit_paid + payments_received <= grand_total
  ),
  constraint proforma_invoices_line_items_array check (jsonb_typeof(line_items) = 'array'),
  constraint proforma_invoices_status_valid check (status in ('ISSUED', 'CHECKED_IN', 'DECLINED')),
  constraint proforma_invoices_amendment_valid check (
    (amendment_no = 0 and amendment_date is null)
    or (amendment_no > 0 and amendment_date is not null)
  )
);

create table if not exists public.proforma_invoice_amendments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.proforma_invoices(id) on delete restrict,
  amendment_no integer not null,
  amendment_date date not null default ((current_timestamp at time zone 'Asia/Singapore')::date),
  amendment_note text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_by_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint proforma_invoice_amendments_number_positive check (amendment_no > 0),
  constraint proforma_invoice_amendments_note_not_blank check (length(btrim(amendment_note)) > 0),
  unique (invoice_id, amendment_no)
);

create table if not exists public.proforma_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.proforma_invoices(id) on delete restrict,
  amount numeric(12,2) not null,
  transaction_id text not null,
  payment_date date not null default ((current_timestamp at time zone 'Asia/Singapore')::date),
  created_by_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint proforma_payments_amount_positive check (amount > 0),
  constraint proforma_payments_transaction_not_blank check (length(btrim(transaction_id)) > 0)
);

create index if not exists proforma_clients_company_name_idx
  on public.proforma_clients (lower(company_name));
create index if not exists proforma_invoices_client_date_idx
  on public.proforma_invoices (client_id, proforma_date desc, created_at desc);
create index if not exists proforma_invoices_status_date_idx
  on public.proforma_invoices (status, proforma_date desc);
create index if not exists proforma_invoice_amendments_invoice_idx
  on public.proforma_invoice_amendments (invoice_id, amendment_no desc);
create index if not exists proforma_payments_invoice_date_idx
  on public.proforma_payments (invoice_id, payment_date desc, created_at desc);
create unique index if not exists proforma_payments_transaction_id_unique_idx
  on public.proforma_payments (lower(transaction_id));

alter table public.proforma_clients enable row level security;
alter table public.proforma_invoices enable row level security;
alter table public.proforma_invoice_amendments enable row level security;
alter table public.proforma_payments enable row level security;

grant usage, select on sequence public.proforma_invoice_number_seq to authenticated;
grant select, insert, update on public.proforma_clients to authenticated;
grant select, insert, update on public.proforma_invoices to authenticated;
grant select, insert on public.proforma_invoice_amendments to authenticated;
grant select, insert on public.proforma_payments to authenticated;

create policy "Front Office can read proforma clients"
  on public.proforma_clients for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can create proforma clients"
  on public.proforma_clients for insert to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can update proforma clients"
  on public.proforma_clients for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  )
  with check (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can read proforma invoices"
  on public.proforma_invoices for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can create proforma invoices"
  on public.proforma_invoices for insert to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can update proforma invoices"
  on public.proforma_invoices for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  )
  with check (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can read proforma amendments"
  on public.proforma_invoice_amendments for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can create proforma amendments"
  on public.proforma_invoice_amendments for insert to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can read proforma payments"
  on public.proforma_payments for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create policy "Front Office can create proforma payments"
  on public.proforma_payments for insert to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid())
        and (
          p.role in ('SUPERUSER', 'MANAGER', 'FO')
          or lower(p.email) in ('fenny@hotelhallmark.com', 'walter@hotelhallmark.com')
        )
    )
  );

create or replace function public.amend_proforma_invoice(
  p_invoice_id bigint,
  p_client_id bigint,
  p_client_company_name text,
  p_client_address text,
  p_client_contact_person text,
  p_client_contact_number text,
  p_check_in_date date,
  p_check_out_date date,
  p_stay_nights integer,
  p_tour_code text,
  p_line_items jsonb,
  p_total_room_count integer,
  p_total_room_nights integer,
  p_grand_total numeric,
  p_deposit_paid numeric,
  p_amendment_note text,
  p_amended_by_name text
)
returns public.proforma_invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_invoice public.proforma_invoices;
begin
  if length(btrim(coalesce(p_amendment_note, ''))) = 0 then
    raise exception 'Amendment reason is required';
  end if;

  select to_jsonb(i)
    into v_before
  from public.proforma_invoices i
  where i.id = p_invoice_id
  for update;

  if v_before is null then
    raise exception 'Proforma invoice not found';
  end if;

  update public.proforma_invoices
  set client_id = p_client_id,
      client_company_name = btrim(p_client_company_name),
      client_address = btrim(coalesce(p_client_address, '')),
      client_contact_person = btrim(p_client_contact_person),
      client_contact_number = btrim(p_client_contact_number),
      check_in_date = p_check_in_date,
      check_out_date = p_check_out_date,
      stay_nights = p_stay_nights,
      tour_code = nullif(btrim(coalesce(p_tour_code, '')), ''),
      line_items = p_line_items,
      total_room_count = p_total_room_count,
      total_room_nights = p_total_room_nights,
      grand_total = p_grand_total,
      deposit_paid = p_deposit_paid,
      amendment_no = amendment_no + 1,
      amendment_date = (current_timestamp at time zone 'Asia/Singapore')::date,
      amendment_note = btrim(p_amendment_note),
      updated_by_user_id = (select auth.uid()),
      updated_by_name = p_amended_by_name,
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  insert into public.proforma_invoice_amendments (
    invoice_id,
    amendment_no,
    amendment_date,
    amendment_note,
    before_snapshot,
    after_snapshot,
    created_by_user_id,
    created_by_name
  ) values (
    v_invoice.id,
    v_invoice.amendment_no,
    v_invoice.amendment_date,
    btrim(p_amendment_note),
    v_before,
    to_jsonb(v_invoice),
    (select auth.uid()),
    p_amended_by_name
  );

  return v_invoice;
end;
$$;

create or replace function public.record_proforma_payment(
  p_invoice_id bigint,
  p_amount numeric,
  p_transaction_id text,
  p_entered_by_name text
)
returns public.proforma_invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice public.proforma_invoices;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if length(btrim(coalesce(p_transaction_id, ''))) = 0 then
    raise exception 'Transaction ID is required';
  end if;

  select * into v_invoice
  from public.proforma_invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found';
  end if;
  if v_invoice.status <> 'CHECKED_IN' then
    raise exception 'Payments can only be recorded after check-in';
  end if;
  if p_amount > v_invoice.balance_outstanding then
    raise exception 'Payment exceeds the outstanding balance';
  end if;

  insert into public.proforma_payments (
    invoice_id,
    amount,
    transaction_id,
    created_by_user_id,
    created_by_name
  ) values (
    p_invoice_id,
    p_amount,
    btrim(p_transaction_id),
    (select auth.uid()),
    p_entered_by_name
  );

  update public.proforma_invoices
  set payments_received = payments_received + p_amount,
      updated_by_user_id = (select auth.uid()),
      updated_by_name = p_entered_by_name,
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.amend_proforma_invoice(
  bigint, bigint, text, text, text, text, date, date, integer, text, jsonb,
  integer, integer, numeric, numeric, text, text
) from public, anon;
grant execute on function public.amend_proforma_invoice(
  bigint, bigint, text, text, text, text, date, date, integer, text, jsonb,
  integer, integer, numeric, numeric, text, text
) to authenticated;

revoke all on function public.record_proforma_payment(bigint, numeric, text, text)
  from public, anon;
grant execute on function public.record_proforma_payment(bigint, numeric, text, text)
  to authenticated;

comment on table public.proforma_clients is
  'Reusable company and client profiles for Front Office proforma invoices.';
comment on table public.proforma_invoices is
  'Proforma invoices with client snapshots, automatic totals, lifecycle status and outstanding balance.';
comment on table public.proforma_invoice_amendments is
  'Immutable customer-requested amendment audit trail.';
comment on table public.proforma_payments is
  'Immutable payment records identified by transaction ID.';
