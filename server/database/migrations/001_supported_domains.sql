-- Create supported_domains table
create table supported_domains (
  id uuid default uuid_generate_v4() primary key,
  domain text not null unique,
  created_at timestamptz default now()
);

-- Enable RLS
alter table supported_domains enable row level security;

-- Policies
-- Authenticated users can view supported domains
create policy "Authenticated users can view supported domains" on supported_domains
  for select using (auth.role() = 'authenticated');

-- Authenticated users can insert supported domains (for now open to all auth users)
create policy "Authenticated users can insert supported domains" on supported_domains
  for insert with check (auth.role() = 'authenticated');

-- Authenticated users can delete supported domains
create policy "Authenticated users can delete supported domains" on supported_domains
  for delete using (auth.role() = 'authenticated');

-- Insert default domains
insert into supported_domains (domain) values 
  ('amazon.it'),
  ('amazon.com'),
  ('amazon.co.uk'),
  ('amazon.de'),
  ('amazon.fr'),
  ('amazon.es'),
  ('www.amazon.it'),
  ('www.amazon.com'),
  ('www.amazon.co.uk'),
  ('www.amazon.de'),
  ('www.amazon.fr'),
  ('www.amazon.es'),
  ('swappie.com'),
  ('www.swappie.com'),
  ('refurbed.it'),
  ('www.refurbed.it')
on conflict (domain) do nothing;
