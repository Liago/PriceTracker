-- Add missing INSERT policy for price_history table
-- This allows users to insert price history records for their own products

create policy "Users can insert price history for their products" on price_history
  for insert with check (
    exists (
      select 1 from products
      where products.id = price_history.product_id
      and products.user_id = auth.uid()
    )
  );

-- Optional: If you want the backend service to bypass RLS entirely,
-- use the service_role key instead of the anon key in your backend code
-- (see server/.env file)
