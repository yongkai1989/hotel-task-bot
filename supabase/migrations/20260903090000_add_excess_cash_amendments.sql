create table if not exists public.cash_excess_amendments (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('SHIFT_CASH', 'MANUAL_CASH')),
  source_id uuid not null,
  previous_amount numeric(12,2) not null check (previous_amount >= 0),
  new_amount numeric(12,2) not null check (new_amount >= 0),
  reason text not null check (length(btrim(reason)) > 0),
  amended_by_user_id uuid not null references auth.users(id),
  amended_by_name text not null,
  amended_by_email text not null,
  amended_at timestamptz not null default now()
);

create index if not exists cash_excess_amendments_source_idx
  on public.cash_excess_amendments (source_type, source_id, amended_at desc);

alter table public.cash_excess_amendments enable row level security;

revoke all on table public.cash_excess_amendments from anon, authenticated;

create or replace function public.amend_excess_cash_entry(
  p_source_type text,
  p_source_id uuid,
  p_new_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_type text := upper(trim(coalesce(p_source_type, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_new_amount numeric(12,2) := round(coalesce(p_new_amount, -1), 2);
  v_previous_amount numeric(12,2);
  v_withdrawn_amount numeric(12,2) := 0;
  v_is_banked boolean := false;
  v_profile public.user_profiles%rowtype;
begin
  if not public.is_cash_bank_in_superuser() then
    raise exception 'Only SUPERUSER can amend an excess cash transaction';
  end if;
  if p_source_id is null then
    raise exception 'Excess cash transaction is required';
  end if;
  if v_source_type not in ('SHIFT_CASH', 'MANUAL_CASH') then
    raise exception 'Unsupported excess cash transaction type';
  end if;
  if p_new_amount is null or v_new_amount < 0 then
    raise exception 'New excess cash amount cannot be negative';
  end if;
  if v_reason = '' then
    raise exception 'An amendment reason is required';
  end if;

  if v_source_type = 'SHIFT_CASH' then
    select excess_amount, excess_bank_in_id is not null
      into v_previous_amount, v_is_banked
    from public.fo_checklist_cash_entries
    where id = p_source_id
    for update;
  else
    select excess_amount, excess_bank_in_id is not null
      into v_previous_amount, v_is_banked
    from public.cash_manual_entries
    where id = p_source_id
    for update;
  end if;

  if not found then
    raise exception 'Excess cash transaction not found';
  end if;
  if v_is_banked then
    raise exception 'This excess cash is already included in a bank-in. Reverse the bank-in first';
  end if;
  if v_previous_amount = v_new_amount then
    raise exception 'The new amount must be different from the previous amount';
  end if;

  select coalesce(withdrawn_amount, 0)
    into v_withdrawn_amount
  from public.cash_excess_withdrawals
  where (v_source_type = 'SHIFT_CASH' and cash_entry_id = p_source_id)
     or (v_source_type = 'MANUAL_CASH' and manual_cash_entry_id = p_source_id)
  for update;
  v_withdrawn_amount := coalesce(v_withdrawn_amount, 0);

  if v_new_amount < v_withdrawn_amount then
    raise exception 'New amount cannot be lower than the RM% already withdrawn',
      to_char(v_withdrawn_amount, 'FM999999990.00');
  end if;

  select * into v_profile
  from public.user_profiles
  where user_id = auth.uid()
  limit 1;

  insert into public.cash_excess_amendments (
    source_type, source_id, previous_amount, new_amount, reason,
    amended_by_user_id, amended_by_name, amended_by_email
  ) values (
    v_source_type, p_source_id, v_previous_amount, v_new_amount, v_reason,
    auth.uid(),
    coalesce(v_profile.name, v_profile.email, 'SUPERUSER'),
    coalesce(v_profile.email, '')
  );

  if v_source_type = 'SHIFT_CASH' then
    update public.fo_checklist_cash_entries
    set excess_amount = v_new_amount,
        updated_at = now()
    where id = p_source_id;
  else
    update public.cash_manual_entries
    set excess_amount = v_new_amount,
        updated_at = now()
    where id = p_source_id;
  end if;

  return jsonb_build_object(
    'source_type', v_source_type,
    'source_id', p_source_id,
    'previous_amount', v_previous_amount,
    'new_amount', v_new_amount,
    'withdrawn_amount', v_withdrawn_amount,
    'available_amount', v_new_amount - v_withdrawn_amount
  );
end;
$$;

revoke execute on function public.amend_excess_cash_entry(text, uuid, numeric, text)
  from public, anon;
grant execute on function public.amend_excess_cash_entry(text, uuid, numeric, text)
  to authenticated, service_role;
