-- Create user_settings table
create table user_settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null unique,
  price_check_interval integer default 6, -- hours between price checks
  scrape_delay integer default 2000, -- milliseconds between scrapes
  max_retries integer default 1, -- retry attempts on scrape failure
  email_notifications boolean default true, -- enable/disable email notifications
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table user_settings enable row level security;

-- Policies
create policy "Users can view their own settings" on user_settings
  for select using (auth.uid() = user_id);

create policy "Users can insert their own settings" on user_settings
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own settings" on user_settings
  for update using (auth.uid() = user_id);

-- Create default settings for existing users
insert into user_settings (user_id, price_check_interval, scrape_delay, max_retries)
select id, 6, 2000, 1 from auth.users
on conflict (user_id) do nothing;

-- Function to auto-create settings for new users
create or replace function create_default_user_settings()
returns trigger as $$
begin
  insert into user_settings (user_id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create settings on user signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure create_default_user_settings();
