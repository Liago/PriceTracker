-- Add missing INSERT policy for price_history table
-- This policy allows authenticated users to insert price history records for their own products
-- Note: The scheduled function uses service_role key which bypasses RLS,
-- but this policy is useful for any authenticated client-side operations

create policy "Users can insert price history for their products" on price_history
  for insert with check (
    exists (
      select 1 from products
      where products.id = price_history.product_id
      and products.user_id = auth.uid()
    )
  );
