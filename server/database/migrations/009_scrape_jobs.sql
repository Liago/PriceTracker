-- 009 - Coda di lavoro per i controlli prezzo.
--
-- Chiude i difetti D10 e D11. Oggi il controllo e' un ciclo sequenziale dentro
-- una singola invocazione, con una pausa fra un prodotto e l'altro: su Netlify
-- supera il timeout appena i prodotti crescono, e i prodotti in coda non
-- vengono mai controllati. In piu' convivono due scheduler - node-cron ogni
-- minuto in locale, una function oraria in produzione - con comportamenti
-- diversi.
--
-- Con la coda il dispatcher accoda soltanto, e i worker consumano a lotti,
-- ognuno entro il proprio budget di tempo.
--
-- Idempotente: puo' essere rieseguita senza effetti.

create table if not exists public.scrape_jobs (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references public.products(id) on delete cascade,
  url          text not null,
  domain       text not null,
  priority     integer not null default 100,
  trigger      text not null default 'scheduled',
  status       text not null default 'pending',
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  claimed_by   text,
  claimed_at   timestamptz,
  run_after    timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint scrape_jobs_status_check
    check (status in ('pending', 'claimed', 'done', 'failed', 'dead'))
);

comment on table public.scrape_jobs is
  'Coda dei controlli prezzo. priority piu'' bassa = servito prima; run_after permette il backoff senza tenere il job occupato.';

-- Indice parziale sui soli job prendibili: e' su questo che gira il claim.
create index if not exists idx_scrape_jobs_claimable
  on public.scrape_jobs (run_after, priority, created_at)
  where status = 'pending';

-- Un solo job in attesa per prodotto: senza, un dispatcher che gira due volte
-- accoderebbe lo stesso lavoro due volte.
create unique index if not exists idx_scrape_jobs_one_pending
  on public.scrape_jobs (product_id)
  where status in ('pending', 'claimed');

create index if not exists idx_scrape_jobs_domain on public.scrape_jobs (domain, status);

-- CLAIM ATOMICO ------------------------------------------------------------
--
-- for update skip locked e' cio' che permette a piu' worker concorrenti di
-- prendere lotti disgiunti senza bloccarsi a vicenda: chi arriva secondo
-- salta le righe gia' bloccate invece di aspettarle.

create or replace function public.claim_scrape_jobs(
  worker_id text,
  batch_size integer default 10,
  only_domains text[] default null
)
returns setof public.scrape_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidati as (
    select j.id
      from public.scrape_jobs j
     where j.status = 'pending'
       and j.run_after <= now()
       and (only_domains is null or j.domain = any(only_domains))
     order by j.priority, j.created_at
     limit batch_size
     for update skip locked
  )
  update public.scrape_jobs j
     set status = 'claimed',
         claimed_by = worker_id,
         claimed_at = now(),
         attempts = j.attempts + 1,
         updated_at = now()
    from candidati c
   where j.id = c.id
  returning j.*;
end;
$$;

comment on function public.claim_scrape_jobs is
  'Prende atomicamente un lotto di job. Usa for update skip locked, quindi worker concorrenti ottengono lotti disgiunti senza bloccarsi.';

-- Rimette in coda i job rimasti appesi: un worker che muore a meta' lascia il
-- job in stato claimed, e senza questa funzione resterebbe li' per sempre.
create or replace function public.requeue_stale_scrape_jobs(
  stale_after interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.scrape_jobs
     set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
         claimed_by = null,
         claimed_at = null,
         last_error = coalesce(last_error, 'worker non ha completato il job'),
         updated_at = now()
   where status = 'claimed'
     and claimed_at < now() - stale_after;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- RLS ----------------------------------------------------------------------
--
-- La coda e' infrastruttura: solo il service_role la vede.

alter table public.scrape_jobs enable row level security;

grant all on public.scrape_jobs to service_role;
grant execute on function public.claim_scrape_jobs(text, integer, text[]) to service_role;
grant execute on function public.requeue_stale_scrape_jobs(interval) to service_role;
