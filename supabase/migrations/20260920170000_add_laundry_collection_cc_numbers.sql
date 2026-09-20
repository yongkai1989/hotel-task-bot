create table if not exists public.linen_laundry_collections (
  id uuid primary key default gen_random_uuid(),
  cc_no text not null,
  collection_date date not null,
  source_service_date date not null,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linen_laundry_collections_cc_no_not_blank
    check (length(trim(cc_no)) > 0),
  constraint linen_laundry_collections_collection_date_key
    unique (collection_date)
);

create unique index if not exists linen_laundry_collections_cc_no_key
  on public.linen_laundry_collections (lower(trim(cc_no)));

alter table public.linen_laundry_collections enable row level security;

drop policy if exists "Laundry collections read" on public.linen_laundry_collections;
create policy "Laundry collections read"
  on public.linen_laundry_collections
  for select
  to authenticated
  using (true);

drop policy if exists "Laundry collections write" on public.linen_laundry_collections;
create policy "Laundry collections write"
  on public.linen_laundry_collections
  for all
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

grant select, insert, update, delete
  on public.linen_laundry_collections
  to authenticated;

alter table public.linen_laundry_bill
  add column if not exists collection_id uuid;

alter table public.linen_laundry_received
  add column if not exists collection_id uuid,
  add column if not exists received_date date;

insert into public.linen_laundry_collections (
  cc_no,
  collection_date,
  source_service_date,
  is_legacy
)
select
  'LEGACY-' || to_char(bill.service_date, 'YYYYMMDD'),
  bill.service_date,
  case
    when bill.service_date >= date '2026-09-16' then bill.service_date - 1
    else bill.service_date
  end,
  true
from public.linen_laundry_bill bill
group by bill.service_date
on conflict (collection_date) do nothing;

update public.linen_laundry_bill bill
set collection_id = collection.id
from public.linen_laundry_collections collection
where bill.collection_id is null
  and collection.collection_date = bill.service_date;

update public.linen_laundry_received received
set
  collection_id = collection.id,
  received_date = coalesce(
    received.received_date,
    (received.created_at at time zone 'Asia/Singapore')::date
  )
from public.linen_laundry_collections collection
where collection.collection_date = received.service_date
  and (received.collection_id is null or received.received_date is null);

alter table public.linen_laundry_bill
  alter column collection_id set not null;

alter table public.linen_laundry_received
  alter column collection_id set not null,
  alter column received_date set not null;

alter table public.linen_laundry_bill
  drop constraint if exists linen_laundry_bill_collection_id_fkey,
  add constraint linen_laundry_bill_collection_id_fkey
    foreign key (collection_id)
    references public.linen_laundry_collections(id)
    on delete restrict;

alter table public.linen_laundry_received
  drop constraint if exists linen_laundry_received_collection_id_fkey,
  add constraint linen_laundry_received_collection_id_fkey
    foreign key (collection_id)
    references public.linen_laundry_collections(id)
    on delete restrict;

create index if not exists linen_laundry_bill_collection_id_idx
  on public.linen_laundry_bill(collection_id);

create index if not exists linen_laundry_received_collection_id_idx
  on public.linen_laundry_received(collection_id);

create index if not exists linen_laundry_received_received_date_idx
  on public.linen_laundry_received(received_date);

comment on table public.linen_laundry_collections is
  'One supplier collection batch identified by its CC number. source_service_date records the housekeeping day that produced the dirty linen.';

comment on column public.linen_laundry_collections.cc_no is
  'Supplier collection control number printed on the collection document.';

comment on column public.linen_laundry_received.received_date is
  'The physical date on which clean linen was returned to the hotel.';
