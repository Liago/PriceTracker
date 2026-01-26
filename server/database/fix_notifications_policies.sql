-- Enable RLS
alter table notifications enable row level security;

-- POLICY: SELECT
drop policy if exists "Users can view their own notifications" on notifications;
create policy "Users can view their own notifications" on notifications
  for select using (auth.uid() = user_id);

-- POLICY: UPDATE
drop policy if exists "Users can update their own notifications" on notifications;
create policy "Users can update their own notifications" on notifications
  for update using (auth.uid() = user_id);

-- POLICY: DELETE
drop policy if exists "Users can delete their own notifications" on notifications;
create policy "Users can delete their own notifications" on notifications
  for delete using (auth.uid() = user_id);

-- POLICY: INSERT (Usually server-side only, but good to have if needed)
drop policy if exists "Users can insert their own notifications" on notifications;
create policy "Users can insert their own notifications" on notifications
  for insert with check (auth.uid() = user_id);
