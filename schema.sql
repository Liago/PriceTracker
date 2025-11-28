-- Create products table
create table products (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
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

-- Create price history table
create table price_history (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade not null,
  price numeric not null,
  recorded_at timestamptz default now()
);

-- Enable RLS
alter table products enable row level security;
alter table price_history enable row level security;

-- Policies
create policy "Users can view their own products" on products
  for select using (auth.uid() = user_id);

create policy "Users can insert their own products" on products
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own products" on products
  for update using (auth.uid() = user_id);

create policy "Users can delete their own products" on products
  for delete using (auth.uid() = user_id);

create policy "Users can view price history of their products" on price_history
  for select using (
    exists (
      select 1 from products
      where products.id = price_history.product_id
      and products.user_id = auth.uid()
    )
  );
