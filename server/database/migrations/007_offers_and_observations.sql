-- 007 - Offerte e osservazioni: il tracking diventa verificabile.
--
-- Due problemi che questa migrazione risolve.
--
-- Il primo (difetto D6) e' che oggi l'unita' di tracking e' l'URL. Su
-- BackMarket, eBay, Swappie o Zalando il prezzo dipende dalla variante -
-- taglia, colore, memoria, condizione, venditore - quindi la storia prezzi di
-- un ricondizionato mescola "256 GB grado A" e "128 GB grado C" a seconda di
-- cosa la pagina mostrava per prima. Il grafico mostra crolli e rimbalzi che
-- non sono mai avvenuti. product_offers rende ogni serie storica coerente con
-- se stessa.
--
-- Il secondo (difetto D8) e' che price_history viene scritta SOLO quando il
-- prezzo cambia, e i fallimenti fanno continue senza lasciare traccia: un
-- prezzo stabile e uno scraper rotto da tre settimane sono indistinguibili.
-- price_observations registra ogni controllo, anche quando non cambia nulla e
-- anche quando fallisce.
--
-- Idempotente: puo' essere rieseguita senza effetti.

-- PRODUCT OFFERS -----------------------------------------------------------

create table if not exists public.product_offers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  offer_key     text not null,
  variant       jsonb not null default '{}'::jsonb,
  seller        text,
  condition     text,
  gtin          text,
  sku           text,
  url           text,
  is_primary    boolean not null default false,
  current_price numeric(12,2),
  currency      char(3),
  availability  text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (product_id, offer_key)
);

comment on table public.product_offers is
  'L''unita'' reale di tracking: variante + venditore + condizione. Senza, la storia prezzi di un ricondizionato mescola tagli di memoria diversi.';
comment on column public.product_offers.offer_key is
  'Hash stabile di variante, venditore e condizione. Vale ''default'' quando la pagina non espone varianti.';

create index if not exists idx_product_offers_product on public.product_offers (product_id);

-- Al piu' un'offerta primaria per prodotto: e' quella che il cruscotto mostra.
create unique index if not exists idx_product_offers_one_primary
  on public.product_offers (product_id) where is_primary;

-- PRICE OBSERVATIONS -------------------------------------------------------

create table if not exists public.price_observations (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  offer_id      uuid references public.product_offers(id) on delete cascade,
  run_id        uuid references public.scrape_runs(id) on delete set null,
  price         numeric(12,2),
  currency      char(3),
  availability  text,
  confidence    numeric(4,3),
  accepted      boolean not null default true,
  reject_reason text,
  observed_at   timestamptz not null default now()
);

comment on table public.price_observations is
  'Ogni controllo lascia una riga, anche quando il prezzo non cambia e anche quando il parse fallisce. accepted=false significa quarantena: il valore e'' registrato ma non entra nella storia.';

create index if not exists idx_price_obs_offer_time
  on public.price_observations (offer_id, observed_at desc);
create index if not exists idx_price_obs_product_time
  on public.price_observations (product_id, observed_at desc);
-- Le sole osservazioni accettate: e' l'insieme su cui si calcolano le mediane
-- dei controlli di plausibilita'.
create index if not exists idx_price_obs_accepted
  on public.price_observations (offer_id, observed_at desc) where accepted;

-- PRODUCTS: campi di identita' e salute del tracking ------------------------

alter table public.products
  add column if not exists canonical_url        text,
  add column if not exists domain               text,
  add column if not exists availability         text,
  add column if not exists primary_offer_id     uuid,
  add column if not exists gtin                 text,
  add column if not exists sku                  text,
  add column if not exists brand                text,
  add column if not exists tracking_health      text,
  add column if not exists last_success_at      timestamptz,
  add column if not exists consecutive_failures integer;

-- I default vanno affermati a parte: dove la colonna esisteva gia' "add column
-- if not exists" non fa nulla, e un database esistente resterebbe diverso da
-- uno ricreato da zero. E' la lezione della migrazione 003.
update public.products set tracking_health = 'unknown' where tracking_health is null;
update public.products set consecutive_failures = 0     where consecutive_failures is null;

alter table public.products
  alter column tracking_health      set default 'unknown',
  alter column tracking_health      set not null,
  alter column consecutive_failures set default 0,
  alter column consecutive_failures set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_tracking_health_check'
  ) then
    alter table public.products add constraint products_tracking_health_check
      check (tracking_health in ('healthy', 'degraded', 'broken', 'blocked', 'unknown'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_primary_offer_fk'
  ) then
    alter table public.products add constraint products_primary_offer_fk
      foreign key (primary_offer_id) references public.product_offers(id) on delete set null;
  end if;
end $$;

comment on column public.products.tracking_health is
  'healthy: ultimo controllo riuscito. degraded: identita'' cambiata o dati parziali. broken: fallimenti ripetuti. blocked: dominio non interrogabile.';

create index if not exists idx_products_tracking_health
  on public.products (tracking_health) where tracking_health <> 'healthy';

-- BACKFILL -----------------------------------------------------------------

-- Un'offerta "default" per ogni prodotto esistente: da qui in poi la storia
-- prezzi appartiene a un'offerta, non a un URL.
insert into public.product_offers (product_id, offer_key, is_primary, current_price, currency, url, last_seen_at)
select p.id, 'default', true, p.current_price, coalesce(p.currency, 'EUR'), p.url, p.last_checked_at
  from public.products p
 where not exists (
   select 1 from public.product_offers o where o.product_id = p.id and o.offer_key = 'default'
 );

update public.products p
   set primary_offer_id = o.id
  from public.product_offers o
 where o.product_id = p.id and o.offer_key = 'default' and p.primary_offer_id is null;

update public.products
   set domain = lower(regexp_replace(split_part(split_part(url, '://', 2), '/', 1), '^www\.', ''))
 where domain is null and url is not null;

-- Lo storico esistente diventa osservazioni accettate, cosi' i controlli di
-- plausibilita' hanno da subito una mediana su cui lavorare.
insert into public.price_observations (product_id, offer_id, price, currency, accepted, observed_at)
select h.product_id, o.id, h.price, coalesce(p.currency, 'EUR'), true, h.recorded_at
  from public.price_history h
  join public.products p       on p.id = h.product_id
  join public.product_offers o on o.product_id = h.product_id and o.offer_key = 'default'
 where not exists (
   select 1 from public.price_observations obs
    where obs.offer_id = o.id and obs.observed_at = h.recorded_at and obs.price = h.price
 );

-- VISTA DI COMPATIBILITA' --------------------------------------------------

-- I punti di cambio prezzo derivati dalle osservazioni accettate. Il client
-- puo' migrarci sopra senza che price_history smetta di essere scritta: fino
-- ad allora le due convivono (dual write).
create or replace view public.price_history_v as
select id, product_id, offer_id, price, currency, observed_at as recorded_at
  from (
    select o.*,
           lag(o.price) over (partition by o.offer_id order by o.observed_at) as prev_price
      from public.price_observations o
     where o.accepted and o.price is not null
  ) t
 where prev_price is null or prev_price is distinct from price;

comment on view public.price_history_v is
  'Punti di cambio prezzo derivati da price_observations. Sostituira'' price_history quando il client sara'' migrato.';

-- RLS E GRANTS -------------------------------------------------------------

alter table public.product_offers     enable row level security;
alter table public.price_observations enable row level security;

drop policy if exists "Users can view offers of their products" on public.product_offers;
create policy "Users can view offers of their products" on public.product_offers
  for select using (
    exists (select 1 from public.products p where p.id = product_offers.product_id and p.user_id = auth.uid())
  );

drop policy if exists "Users can view observations of their products" on public.price_observations;
create policy "Users can view observations of their products" on public.price_observations
  for select using (
    exists (select 1 from public.products p where p.id = price_observations.product_id and p.user_id = auth.uid())
  );

-- La scrittura resta al server: e' il motore a decidere cosa entra nella
-- storia, non il client.
grant select on public.product_offers     to authenticated;
grant select on public.price_observations to authenticated;
grant select on public.price_history_v    to authenticated;
grant all    on public.product_offers     to service_role;
grant all    on public.price_observations to service_role;
