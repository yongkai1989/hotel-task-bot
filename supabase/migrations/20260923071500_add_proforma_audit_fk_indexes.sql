-- Cover the proforma audit foreign keys so joins and future user cleanup checks
-- do not require table scans as the register grows.
create index if not exists proforma_clients_created_by_idx
  on public.proforma_clients (created_by_user_id);

create index if not exists proforma_invoices_created_by_idx
  on public.proforma_invoices (created_by_user_id);

create index if not exists proforma_invoices_updated_by_idx
  on public.proforma_invoices (updated_by_user_id);

create index if not exists proforma_amendments_created_by_idx
  on public.proforma_invoice_amendments (created_by_user_id);

create index if not exists proforma_payments_created_by_idx
  on public.proforma_payments (created_by_user_id);
