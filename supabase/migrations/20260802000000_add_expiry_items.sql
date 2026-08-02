create table if not exists public.expiry_items (
  id uuid primary key default gen_random_uuid(),
  barcode text not null check (length(trim(barcode)) > 0),
  product_name text not null check (length(trim(product_name)) > 0),
  expires_on date not null,
  location text not null check (length(trim(location)) > 0),
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expiry_items_expires_on_idx on public.expiry_items (expires_on);
create index if not exists expiry_items_barcode_idx on public.expiry_items (barcode);

alter table public.expiry_items enable row level security;
grant select, insert, update, delete on public.expiry_items to anon, authenticated;

create policy "expiry_items_select" on public.expiry_items for select to anon, authenticated using (true);
create policy "expiry_items_insert" on public.expiry_items for insert to anon, authenticated with check (true);
create policy "expiry_items_update" on public.expiry_items for update to anon, authenticated using (true) with check (true);
create policy "expiry_items_delete" on public.expiry_items for delete to anon, authenticated using (true);
