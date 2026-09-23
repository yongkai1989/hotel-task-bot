grant delete on public.proforma_invoices to authenticated;
grant delete on public.proforma_invoice_amendments to authenticated;
grant delete on public.proforma_payments to authenticated;

drop policy if exists "Superusers can delete proforma invoices" on public.proforma_invoices;
create policy "Superusers can delete proforma invoices"
  on public.proforma_invoices
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.role = 'SUPERUSER'
    )
  );

drop policy if exists "Superusers can delete proforma amendments" on public.proforma_invoice_amendments;
create policy "Superusers can delete proforma amendments"
  on public.proforma_invoice_amendments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.role = 'SUPERUSER'
    )
  );

drop policy if exists "Superusers can delete proforma payments" on public.proforma_payments;
create policy "Superusers can delete proforma payments"
  on public.proforma_payments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.role = 'SUPERUSER'
    )
  );

create or replace function public.delete_proforma_invoice(p_invoice_id bigint)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted_id bigint;
begin
  if not exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'SUPERUSER'
  ) then
    raise exception 'Only a superuser can delete a proforma invoice.'
      using errcode = '42501';
  end if;

  delete from public.proforma_payments
  where invoice_id = p_invoice_id;

  delete from public.proforma_invoice_amendments
  where invoice_id = p_invoice_id;

  delete from public.proforma_invoices
  where id = p_invoice_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Proforma invoice not found.'
      using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_proforma_invoice(bigint) from public;
revoke all on function public.delete_proforma_invoice(bigint) from anon;
grant execute on function public.delete_proforma_invoice(bigint) to authenticated;

comment on function public.delete_proforma_invoice(bigint) is
  'Atomically deletes one proforma invoice and its dependent payment and amendment records. Restricted to SUPERUSER profiles.';
