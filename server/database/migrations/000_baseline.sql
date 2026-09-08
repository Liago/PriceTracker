-- 000 - Baseline: lo schema esistente, reso riproducibile da zero.
--
-- Fino a questa migrazione lo schema viveva in quattro file SQL sparsi
-- (schema.sql, notifications_schema.sql, user_settings_schema.sql,
-- database/indexes.sql) da incollare a mano nella console Supabase, piu' due
-- file di correzione delle policy applicati dopo. Nessuno di essi era
-- versionato ne' idempotente, quindi lo schema di produzione e quello dei file
-- avevano gia' divergito (difetto D14).
--
-- Questa migrazione consolida tutto in un unico punto ed e' scritta per essere
-- sicura sia su un database vuoto sia su quello di produzione, dove tutti gli
-- oggetti esistono gia': ogni create e' condizionale e ogni policy viene
-- ricreata. Le policy riflettono database/policies.sql e
-- database/fix_notifications_policies.sql, che sono la versione corrente.

-- TABELLE ------------------------------------------------------------------

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  url text not null,
  name text,
  image text,
  description text,
  current_price numeric,
  currency text default 'EUR',
  target_price numeric,
  monitoring_until date,
  last_checked_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric not null,
  recorded_at timestamptz default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null,
  old_price numeric,
  new_price numeric,
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users,
  price_check_interval integer default 360,
  scrape_delay integer default 2000,
  max_retries integer default 1,
  email_notifications boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS ----------------------------------------------------------------------

alter table public.products      enable row level security;
alter table public.price_history enable row level security;
alter table public.notifications enable row level security;
alter table public.user_settings enable row level security;

-- POLICY: products ---------------------------------------------------------

drop policy if exists "Users can view their own products" on public.products;
create policy "Users can view their own products" on public.products
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own products" on public.products;
create policy "Users can insert their own products" on public.products
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own products" on public.products;
create policy "Users can update their own products" on public.products
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own products" on public.products;
create policy "Users can delete their own products" on public.products
  for delete using (auth.uid() = user_id);

-- POLICY: price_history ----------------------------------------------------

drop policy if exists "Users can view price history of their products" on public.price_history;
create policy "Users can view price history of their products" on public.price_history
  for select using (
    exists (
      select 1 from public.products
      where products.id = price_history.product_id
        and products.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert price history for their products" on public.price_history;
create policy "Users can insert price history for their products" on public.price_history
  for insert with check (
    exists (
      select 1 from public.products
      where products.id = price_history.product_id
        and products.user_id = auth.uid()
    )
  );

-- POLICY: notifications ----------------------------------------------------

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own notifications" on public.notifications;
create policy "Users can insert their own notifications" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications" on public.notifications
  for delete using (auth.uid() = user_id);

-- POLICY: user_settings ----------------------------------------------------

drop policy if exists "Users can view their own settings" on public.user_settings;
create policy "Users can view their own settings" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own settings" on public.user_settings;
create policy "Users can insert their own settings" on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own settings" on public.user_settings;
create policy "Users can update their own settings" on public.user_settings
  for update using (auth.uid() = user_id);

-- INDICI -------------------------------------------------------------------

create index if not exists idx_products_user_id            on public.products (user_id);
create index if not exists idx_price_history_product_id    on public.price_history (product_id);
create index if not exists idx_price_history_recorded_at   on public.price_history (recorded_at desc);
create index if not exists idx_notifications_user_id_read  on public.notifications (user_id, read);

-- IMPOSTAZIONI DI DEFAULT PER GLI UTENTI ESISTENTI --------------------------

insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_default_user_settings()
returns trigger as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_default_user_settings();
