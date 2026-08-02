alter table public.products
  add column barcode text;

alter table public.products
  add constraint products_barcode_not_blank
  check (barcode is null or length(trim(barcode)) > 0);

create unique index products_barcode_unique_idx
  on public.products (barcode)
  where barcode is not null;
