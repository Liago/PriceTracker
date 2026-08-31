-- 005 - Le ricette di scraping a database.
--
-- E' il cuore del refactor: i parametri dello scraper smettono di essere
-- codice e diventano dati. Il motore passa da "contenitore di selettori" a
-- "interprete di ricette", e aggiungere uno store non richiede piu' un deploy.
--
-- Tre tabelle:
--   domain_profiles  cosa sappiamo di un dominio (trasporto, locale, limiti)
--   scrape_recipes   come si legge una pagina di quel dominio, versionata
--   scrape_runs      audit di ogni esecuzione, con i candidati considerati
--
-- Idempotente: puo' essere rieseguita senza effetti.

-- DOMAIN PROFILES ----------------------------------------------------------

create table if not exists public.domain_profiles (
  id                uuid primary key default gen_random_uuid(),
  domain            text not null unique,
  platform          text,
  transport         text not null default 'auto',
  requires_js       boolean not null default false,
  render_wait       jsonb,
  request_headers   jsonb not null default '{}'::jsonb,
  user_agent_class  text default 'desktop_chrome',
  cookies           jsonb not null default '[]'::jsonb,
  locale            text,
  default_currency  char(3),
  price_format      jsonb,
  rate_limit_rpm    integer not null default 6,
  min_interval_ms   integer not null default 10000,
  robots_allowed    boolean,
  robots_checked_at timestamptz,
  anti_bot          text,
  block_reason      text,
  blocked_until     timestamptz,
  success_count     integer not null default 0,
  failure_count     integer not null default 0,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.domain_profiles is
  'Cosa il motore ha imparato su un dominio. Sostituisce la whitelist supported_domains con un modello aperto per default, chiuso per eccezione via block_reason.';

-- SCRAPE RECIPES -----------------------------------------------------------

create table if not exists public.scrape_recipes (
  id             uuid primary key default gen_random_uuid(),
  domain         text not null,
  url_pattern    text not null default '*',
  scope          text not null default 'domain',
  product_id     uuid references public.products(id) on delete cascade,
  version        integer not null default 1,
  status         text not null default 'candidate',
  origin         text not null default 'learned',
  transport      text not null default 'http',
  render_wait    jsonb,
  headers        jsonb not null default '{}'::jsonb,
  pre_actions    jsonb not null default '[]'::jsonb,
  fields         jsonb not null,
  post_rules     jsonb not null default '{}'::jsonb,
  confidence     numeric(4,3) not null default 0,
  success_count  integer not null default 0,
  failure_count  integer not null default 0,
  consecutive_failures integer not null default 0,
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  learned_from_run uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint scrape_recipes_status_check
    check (status in ('active', 'candidate', 'deprecated', 'quarantined')),
  constraint scrape_recipes_origin_check
    check (origin in ('learned', 'manual', 'seeded')),
  constraint scrape_recipes_scope_check
    check (scope in ('domain', 'url_pattern', 'product')),
  -- Una ricetta di ambito product deve indicare il prodotto, le altre no.
  constraint scrape_recipes_product_scope_check
    check ((scope = 'product') = (product_id is not null))
);

comment on table public.scrape_recipes is
  'Configurazione appresa per leggere le pagine di un dominio. Versionata: una nuova strategia nasce candidate e diventa active dopo N successi, la precedente passa a deprecated per permettere il rollback.';
comment on column public.scrape_recipes.fields is
  'Mappa campo -> strategia di estrazione. Nessuna delle sue chiavi esiste nel codice: il motore sa solo eseguire "strategy".';

-- Una sola versione per numero, dentro lo stesso ambito. product_id e'
-- nullable, quindi coalesce lo rende confrontabile in un indice unico.
create unique index if not exists idx_scrape_recipes_version
  on public.scrape_recipes (domain, url_pattern, scope, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

-- Al piu' una ricetta attiva per ambito: e' l'invariante che impedisce al
-- fast path di trovarne due e sceglierne una a caso.
create unique index if not exists idx_scrape_recipes_one_active
  on public.scrape_recipes (domain, url_pattern, scope, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create index if not exists idx_scrape_recipes_lookup
  on public.scrape_recipes (domain, status);

-- SCRAPE RUNS --------------------------------------------------------------

create table if not exists public.scrape_runs (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid references public.products(id) on delete cascade,
  url            text not null,
  domain         text not null,
  recipe_id      uuid references public.scrape_recipes(id) on delete set null,
  recipe_version integer,
  trigger        text not null default 'manual',
  transport_used text,
  tier_escalations integer not null default 0,
  status         text not null,
  http_status    integer,
  duration_ms    integer,
  attempts       integer not null default 1,
  extractors_ran jsonb not null default '[]'::jsonb,
  winning_source text,
  candidates     jsonb not null default '[]'::jsonb,
  confidence     numeric(4,3),
  result         jsonb,
  validation     jsonb,
  error_code     text,
  error_message  text,
  html_hash      text,
  snapshot_path  text,
  created_at     timestamptz not null default now(),

  constraint scrape_runs_status_check
    check (status in ('success', 'partial', 'failed', 'blocked', 'quarantined'))
);

comment on table public.scrape_runs is
  'Audit di ogni esecuzione: quali estrattori hanno girato, tutti i candidati con il loro punteggio, chi ha vinto e perche''. Senza questa tabella un fallimento resta invisibile.';

create index if not exists idx_scrape_runs_product_time
  on public.scrape_runs (product_id, created_at desc);
create index if not exists idx_scrape_runs_domain_status
  on public.scrape_runs (domain, status, created_at desc);
create index if not exists idx_scrape_runs_recipe
  on public.scrape_runs (recipe_id, created_at desc);

-- RLS ----------------------------------------------------------------------
--
-- Queste tre tabelle sono infrastruttura condivisa, non dato di un utente:
-- la scrittura e' riservata al service_role. Gli utenti autenticati leggono
-- solo attraverso viste che escludono header e cookie, che possono contenere
-- materiale di sessione.

alter table public.domain_profiles enable row level security;
alter table public.scrape_recipes  enable row level security;
alter table public.scrape_runs     enable row level security;

-- Nessuna policy per authenticated: senza policy, RLS nega tutto. Il
-- service_role bypassa RLS per definizione.

drop policy if exists "Service role manages domain profiles" on public.domain_profiles;
drop policy if exists "Service role manages recipes" on public.scrape_recipes;
drop policy if exists "Service role manages runs" on public.scrape_runs;

-- VISTE DI SOLA LETTURA ----------------------------------------------------

create or replace view public.scrape_recipes_public as
  select id, domain, url_pattern, scope, version, status, origin, transport,
         fields, confidence, success_count, failure_count, consecutive_failures,
         last_success_at, last_failure_at, created_at, updated_at
    from public.scrape_recipes;

comment on view public.scrape_recipes_public is
  'Vista delle ricette senza headers, cookies e pre_actions, che possono contenere materiale di sessione.';

create or replace view public.domain_profiles_public as
  select id, domain, platform, transport, requires_js, locale, default_currency,
         rate_limit_rpm, robots_allowed, anti_bot, block_reason, blocked_until,
         success_count, failure_count, last_success_at, last_failure_at
    from public.domain_profiles;

-- GRANTS -------------------------------------------------------------------

grant select on public.scrape_recipes_public  to authenticated;
grant select on public.domain_profiles_public to authenticated;

grant all on public.domain_profiles to service_role;
grant all on public.scrape_recipes  to service_role;
grant all on public.scrape_runs     to service_role;

-- Nessun grant ad anon: nessuna di queste tabelle e' letta senza sessione.
