alter table public.products
  add column if not exists specs jsonb not null default '{}'::jsonb;

comment on column public.products.specs is
  'Flexible specifications for PCs, monitors, peripherals, and other equipment';
