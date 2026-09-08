-- Create supported_domains table
-- Reso idempotente: il runner delle migrazioni deve poter girare anche su un
-- database dove questa tabella e' gia' stata creata a mano.
create table if not exists public.supported_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.supported_domains enable row level security;

-- Policies
-- Authenticated users can view supported domains
drop policy if exists "Authenticated users can view supported domains" on public.supported_domains;
create policy "Authenticated users can view supported domains" on public.supported_domains
  for select using (auth.role() = 'authenticated');

-- Authenticated users can insert supported domains (for now open to all auth users)
drop policy if exists "Authenticated users can insert supported domains" on public.supported_domains;
create policy "Authenticated users can insert supported domains" on public.supported_domains
  for insert with check (auth.role() = 'authenticated');

-- Authenticated users can delete supported domains
drop policy if exists "Authenticated users can delete supported domains" on public.supported_domains;
create policy "Authenticated users can delete supported domains" on public.supported_domains
  for delete using (auth.role() = 'authenticated');

-- Insert default domains
insert into public.supported_domains (domain) values 
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
