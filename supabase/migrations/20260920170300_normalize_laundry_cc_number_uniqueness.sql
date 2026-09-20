drop index if exists public.linen_laundry_collections_cc_no_key;

create unique index linen_laundry_collections_cc_no_key
  on public.linen_laundry_collections (
    regexp_replace(lower(trim(cc_no)), '[^a-z0-9]+', '', 'g')
  );

comment on index public.linen_laundry_collections_cc_no_key is
  'Prevents duplicate CC numbers even when spaces, dashes or letter casing are entered differently.';
