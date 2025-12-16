-- Database Policies
-- This file contains all Row Level Security (RLS) policies for the application.
-- Run this against your Supabase database to ensure all permissions are correct.

-- Enable RLS (idempotent if already enabled)
alter table products enable row level security;
alter table price_history enable row level security;

-- PRODUCTS TABLE POLICIES -------------------------

-- VIEW
drop policy if exists "Users can view their own products" on products;
create policy "Users can view their own products" on products
  for select using (auth.uid() = user_id);

-- INSERT
drop policy if exists "Users can insert their own products" on products;
create policy "Users can insert their own products" on products
  for insert with check (auth.uid() = user_id);

-- UPDATE
drop policy if exists "Users can update their own products" on products;
create policy "Users can update their own products" on products
  for update using (auth.uid() = user_id);

-- DELETE
drop policy if exists "Users can delete their own products" on products;
create policy "Users can delete their own products" on products
  for delete using (auth.uid() = user_id);


-- PRICE_HISTORY TABLE POLICIES --------------------

-- VIEW
drop policy if exists "Users can view price history of their products" on price_history;
create policy "Users can view price history of their products" on price_history
  for select using (
    exists (
      select 1 from products
      where products.id = price_history.product_id
      and products.user_id = auth.uid()
    )
  );

-- INSERT
drop policy if exists "Users can insert price history for their products" on price_history;
create policy "Users can insert price history for their products" on price_history
  for insert with check (
    exists (
      select 1 from products
      where products.id = price_history.product_id
      and products.user_id = auth.uid()
    )
  );

-- Note: No UPDATE or DELETE policies for price_history are defined yet,
-- as they are typically not needed for historical data in this MVP.
