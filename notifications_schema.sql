-- Create notifications table
create table notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  product_id uuid references products(id) on delete cascade not null,
  type text not null, -- 'price_drop', 'price_increase'
  old_price numeric,
  new_price numeric,
  read boolean default false,
  created_at timestamptz default now()
);

-- Enable RLS
alter table notifications enable row level security;

-- Policies
create policy "Users can view their own notifications" on notifications
  for select using (auth.uid() = user_id);

create policy "Users can update their own notifications" on notifications
  for update using (auth.uid() = user_id);
