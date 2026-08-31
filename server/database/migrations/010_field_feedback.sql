-- 010 - Segnalazioni degli utenti sui campi estratti.
--
-- E' il meccanismo di recupero per i casi che l'euristica sbaglia. Un utente
-- che vede un prezzo errato sa qual e' quello giusto: dandogli un modo di
-- dirlo, quel valore diventa l'input piu' prezioso che il motore possa
-- ricevere, perche' permette di cercare il candidato che lo produce invece di
-- indovinare.
--
-- Idempotente: puo' essere rieseguita senza effetti.

create table if not exists public.scrape_field_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  product_id     uuid references public.products(id) on delete cascade,
  domain         text not null,
  field          text not null,
  reported       text not null,
  expected_value text,
  run_id         uuid references public.scrape_runs(id) on delete set null,
  resolved       boolean not null default false,
  created_at     timestamptz not null default now(),

  constraint scrape_field_feedback_reported_check
    check (reported in ('wrong', 'missing', 'correct')),
  constraint scrape_field_feedback_field_check
    check (field in ('price', 'currency', 'title', 'image', 'availability'))
);

comment on table public.scrape_field_feedback is
  'Segnalazioni degli utenti su un campo estratto male. expected_value e'' il valore che l''utente dichiara corretto: alimenta una scoperta orientata a quel valore.';

create index if not exists idx_field_feedback_domain
  on public.scrape_field_feedback (domain, resolved, created_at desc);
create index if not exists idx_field_feedback_product
  on public.scrape_field_feedback (product_id, created_at desc);

alter table public.scrape_field_feedback enable row level security;

drop policy if exists "Users manage their own feedback" on public.scrape_field_feedback;
create policy "Users manage their own feedback" on public.scrape_field_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "Users can report on their products" on public.scrape_field_feedback;
create policy "Users can report on their products" on public.scrape_field_feedback
  for insert with check (
    auth.uid() = user_id
    and (product_id is null or exists (
      select 1 from public.products p where p.id = product_id and p.user_id = auth.uid()
    ))
  );

grant select, insert on public.scrape_field_feedback to authenticated;
grant all on public.scrape_field_feedback to service_role;
