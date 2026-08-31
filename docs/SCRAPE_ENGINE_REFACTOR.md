# Refactor del motore di scraping — Piano tecnico

**Stato:** proposta di design (nessun codice ancora implementato)
**Branch:** `claude/scrape-engine-refactor-fhpybt`
**Autore:** design doc generato in sessione Claude Code
**Ultimo aggiornamento:** 2026-08-31

---

## 0. Stato di avanzamento

| Fase | Stato | Evidenza |
|------|-------|----------|
| **0 — Fondamenta** | ✅ completata | Vitest + harness a fixture; migrazioni versionate verificate su Postgres 16 (database vuoto e produzione simulata convergono sullo stesso schema); chiusi D4, D9, D13, D14 |
| **1 — Normalizzazione unica** | ✅ completata | `server/scrape/normalize/` come sola implementazione di prezzo, valuta e disponibilita'; rimosse le tre copie divergenti di `parsePrice`; chiuso D5. 169 test verdi |
| 2 — Pipeline in shadow mode | ⏳ da fare | |
| 3 — Ricette a database | ⏳ da fare | |
| 4 — Offerte e osservazioni | ⏳ da fare | |
| 5 — Switch e apertura | ⏳ da fare | |
| 6 — Coda e worker | ⏳ da fare | |
| 7 — Interfaccia e osservabilita' | ⏳ da fare | |

**Difetti chiusi finora:** D4, D5, D9, D13, D14 (5 su 16).
**Nota:** la verifica e' fatta su fixture e su Postgres locale. Il percorso di
scrape reale — rete, browser, anti-bot — non e' esercitabile in ambiente di
sviluppo e va provato in staging prima del rilascio.

---

## 1. Obiettivo

> «Poter leggere qualunque pagina di qualunque shop online, in maniera tale da poter leggere
> con sicurezza tutti i dettagli di un prodotto seguito, soprattutto sulle sue variazioni di
> prezzo. Quando viene analizzata con successo una pagina, tutti i parametri dello scraper
> vanno salvati a db e non hardcoded.»

Tradotto in tre requisiti verificabili:

| # | Requisito | Come lo otteniamo |
|---|-----------|-------------------|
| **R1** | **Copertura universale**: nessuna whitelist di domini, nessuna classe di codice per store | Pipeline di estrazione *generica e a cascata* (dati strutturati → stato applicativo → adapter di piattaforma e-commerce → euristiche DOM) |
| **R2** | **Configurazione persistita**: dopo un parse riuscito, i parametri dello scraper vivono a DB | Tabelle `scrape_recipes` / `scrape_recipe_fields` / `domain_profiles`; il codice diventa un *interprete di ricette*, non un contenitore di selettori |
| **R3** | **Tracking garantito**: il prezzo salvato è quello giusto, sempre, e sappiamo quando non lo è | Confidence scoring, validazione di plausibilità, tracciamento per *offerta/variante*, tabella `price_observations` con audit completo di ogni run |

### 1.1 KPI di accettazione

Il refactor si considera concluso quando, su un *panel di validazione* di ≥ 60 URL prodotto
(≥ 30 domini distinti, di cui almeno 10 mai visti prima dal sistema):

- **Success rate primo parse (dominio sconosciuto):** ≥ 85% con prezzo + valuta + titolo corretti
- **Success rate su ricetta appresa (dominio già visto):** ≥ 97%
- **Falsi positivi di prezzo** (prezzo scritto a DB ma sbagliato: prezzo barrato, rata mensile, spedizione, accessorio): **0** sul panel; in produzione ≤ 0,5% delle osservazioni
- **Silent failure rate** (scrape fallito senza che il sistema se ne accorga): **0** — ogni run produce una riga in `scrape_runs`
- **Latenza mediana** con ricetta in fast-path HTTP: ≤ 1,5 s (oggi ~8-25 s, sempre con browser)
- **Costo**: ≥ 70% dei check ricorrenti serviti senza avviare Chromium

---

## 2. Analisi dello stato attuale

### 2.1 Com'è fatto oggi

```
POST /api/scrape ──► validation.validateProductUrl()   [whitelist domini]
                     └─► scraper.scrapeProduct()       [Puppeteer + stealth + retry]
                          └─► ScraperFactory.getScraper()   [if/else su hostname]
                               └─► XxxScraper.scrape()      [13 classi, selettori hardcoded]
```

- 13 classi in `server/services/scrapers/` (~1.500 righe) + `BaseScraper` (46 righe di helper OG)
- `server/services/scraper.js` — browser lifecycle, UA rotation, proxy, CAPTCHA detection, retry
- `server/services/priceTracker.js` — loop di check periodico + notifiche
- Scrittura a DB fatta **sia** dal client (`client/src/components/Layout.jsx`, `client/src/pages/ProductDetail.jsx`) **sia** dal server (`priceTracker.js`)

### 2.2 Difetti bloccanti rispetto all'obiettivo

| ID | Difetto | Evidenza | Impatto |
|----|---------|----------|---------|
| **D1** | Whitelist di domini chiusa: un URL di uno shop non elencato viene **rifiutato** | `server/utils/validation.js:6-90` | Rende R1 impossibile per costruzione |
| **D2** | Dispatch per `hostname.includes('amazon.')` | `server/services/scrapers/ScraperFactory.js:20-46` | Fragile e insicuro: `mio-amazon.shop.it` prende lo scraper Amazon |
| **D3** | Selettori CSS hardcoded in 13 file; ~180 `querySelector` totali | tutta la cartella `scrapers/` | Ogni redesign di uno store rompe silenziosamente il tracking; ogni nuovo store = codice + deploy |
| **D4** | **Bug attivo**: `priceEl` usato senza essere dichiarato dentro `page.evaluate` | `server/services/scrapers/MediaWorldScraper.js:23` | `ReferenceError` → **ogni scrape MediaWorld fallisce** |
| **D5** | Parsing del prezzo duplicato in 3 implementazioni divergenti | `server/services/priceTracker.js:47`, `client/src/lib/utils.js:1`, inline in `BackMarketScraper.js:150-170` | Stesso prezzo interpretato diversamente a seconda del percorso di codice |
| **D6** | Nessuna nozione di **variante/offerta** (taglia, colore, condizione, venditore, memoria) | tutti gli scraper ritornano un unico `price` | Su BackMarket/Swappie/eBay/Zalando la storia prezzi mescola offerte diverse → grafico privo di senso |
| **D7** | Nessuna validazione di plausibilità del prezzo estratto | `priceTracker.js:143-160` | Un prezzo "spedizione 4,99 €" o un prezzo barrato finiscono in `current_price` senza sospetti |
| **D8** | `price_history` scritta **solo** quando il prezzo cambia; i fallimenti fanno `continue` senza traccia | `priceTracker.js:133,144,164` | Impossibile distinguere «prezzo stabile» da «scraper rotto da tre settimane» |
| **D9** | `getUserSettings()` non restituisce `price_check_interval` → `userSettings.price_check_interval` è sempre `undefined` | `priceTracker.js:35-38` vs `:127` | L'intervallo utente **non viene mai applicato**: sempre 360. In più lo schema documenta *ore* (`user_settings_schema.sql:5`) mentre il codice usa *minuti* |
| **D10** | Doppio scheduler: `node-cron` ogni minuto in `server/index.js:44` **e** funzione schedulata Netlify oraria (`netlify.toml`) | | Comportamento diverso fra locale e produzione |
| **D11** | Check periodico sequenziale con `sleep(scrape_delay)` dentro una singola invocazione | `priceTracker.js:217` | Su Netlify Functions supera il timeout appena i prodotti crescono: i prodotti in coda non vengono mai controllati |
| **D12** | Chromium avviato **sempre**, anche per pagine servite in SSR con JSON-LD completo | `scraper.js:44-80` | Costo e latenza 10-20× superiori al necessario |
| **D13** | Path Chrome locale hardcoded macOS | `scraper.js:69` | Non funziona su Linux/CI |
| **D14** | `store`, `details`, `available` non esistono in `schema.sql`; aggiunti a mano in produzione | `schema.sql:2-15` vs `Layout.jsx:29-30` | Schema DB non riproducibile; nessun sistema di migrazioni |
| **D15** | Il client scrive `products`/`price_history` con la anon key, in parallelo al server | `Layout.jsx:20-33`, `ProductDetail.jsx:84-110` | Due sorgenti di verità, nessuna validazione lato server sui dati scritti |
| **D16** | Zero test | — | Ogni modifica al motore è una scommessa |

---

## 3. Principi di design

1. **Generico prima, specifico dopo.** Nessuno store ha codice dedicato. Le specificità
   vivono come *dati* (ricette) e vengono apprese, non scritte.
2. **La ricetta è il prodotto del successo.** Un parse riuscito non produce solo dati:
   produce (o conferma) la *configurazione* che lo ha reso possibile. Questa è la
   traduzione diretta di R2.
3. **Ogni valore ha una provenienza e una confidenza.** Non scriviamo mai un prezzo a DB
   senza sapere *da dove* viene e *quanto* ci fidiamo.
4. **Meglio nessun dato che un dato sbagliato.** Sotto soglia di confidenza il valore va in
   quarantena, non in `current_price`.
5. **Escalation di costo.** HTTP semplice → HTTP con headers realistici → browser headless →
   browser con interazione. Si sale solo quando serve, e la scelta viene memorizzata.
6. **Il motore si auto-ripara.** Ricetta fallita ⇒ nuova discovery ⇒ nuova versione di
   ricetta. Nessun intervento umano necessario nel caso normale.
7. **Idempotenza e osservabilità.** Ogni run è tracciato, riproducibile da fixture, e
   ripetibile senza effetti collaterali.

---

## 4. Architettura target

```
                          ┌──────────────────────────────────────────┐
   POST /api/scrape ──────►│           ScrapeOrchestrator             │
   worker (job queue) ────►│  (budget, retry, escalation, telemetria) │
                          └──────────────────┬───────────────────────┘
                                             │
        ┌────────────────────────────────────┼─────────────────────────────────┐
        ▼                                    ▼                                 ▼
┌───────────────┐                  ┌──────────────────┐              ┌──────────────────┐
│  UrlPolicy    │                  │  FetchLayer      │              │  RecipeStore     │
│ SSRF guard    │                  │  tier 0 http     │◄────────────►│ (DB: ricette,    │
│ robots/ToS    │                  │  tier 1 http+hdr │   transport  │  profili dominio)│
│ rate limit    │                  │  tier 2 browser  │   & headers  │                  │
│ canonicalize  │                  │  tier 3 browser  │              └────────┬─────────┘
└───────────────┘                  │        +interact │                       │
                                   └────────┬─────────┘                       │
                                            │ Document (html, dom, state)     │
                                            ▼                                 │
                    ┌───────────────────────────────────────────┐             │
                    │            ExtractionPipeline             │             │
                    │  ┌─────────────────────────────────────┐  │             │
                    │  │ E0  LearnedRecipeExtractor  ◄───────────────────────┘
                    │  │ E1  JsonLdExtractor                 │  │
                    │  │ E2  MicrodataRdfaExtractor          │  │
                    │  │ E3  MetaTagExtractor                │  │
                    │  │ E4  AppStateExtractor               │  │
                    │  │ E5  PlatformAdapters (Shopify, …)   │  │
                    │  │ E6  DomHeuristicExtractor           │  │
                    │  └─────────────────────────────────────┘  │
                    │         ▼ candidati con score              │
                    │  ┌─────────────────────────────────────┐  │
                    │  │ Normalizer  (prezzo, valuta, stock, │  │
                    │  │              identità, varianti)    │  │
                    │  └─────────────────────────────────────┘  │
                    │  ┌─────────────────────────────────────┐  │
                    │  │ Reconciler + ConfidenceScorer       │  │
                    │  │ Validator (plausibilità vs storico) │  │
                    │  └─────────────────────────────────────┘  │
                    └───────────────────┬───────────────────────┘
                                        │ ScrapeResult
                    ┌───────────────────┴───────────────────────┐
                    ▼                                           ▼
          ┌──────────────────┐                        ┌────────────────────┐
          │ RecipeLearner    │  scrive/aggiorna       │ Persistence        │
          │ (upsert ricetta) │  la ricetta vincente   │ offers, observations│
          └──────────────────┘                        │ runs, notifiche     │
                                                      └────────────────────┘
```

### 4.1 Struttura file proposta

```
server/scrape/
├── index.js                     # facade pubblica: scrapeUrl(url, opts)
├── orchestrator.js              # budget, escalation di tier, retry, telemetria
├── document.js                  # Document: html grezzo, cheerio/DOM, stato JS, headers
├── fetch/
│   ├── index.js                 # selezione del tier + fallback
│   ├── httpFetcher.js           # tier 0/1 — undici + cheerio
│   ├── browserFetcher.js        # tier 2/3 — puppeteer (riuso di scraper.js)
│   └── browserPool.js           # riuso istanza fra job nello stesso invoke
├── extract/
│   ├── pipeline.js              # esecuzione ordinata + raccolta candidati
│   ├── recipeExtractor.js       # E0 — applica la ricetta a DB
│   ├── jsonLd.js                # E1
│   ├── microdata.js             # E2
│   ├── metaTags.js              # E3
│   ├── appState.js              # E4 — __NEXT_DATA__, __NUXT__, dataLayer, Apollo…
│   ├── platforms/               # E5 — adapter per piattaforma, non per store
│   │   ├── detect.js
│   │   ├── shopify.js  woocommerce.js  magento.js
│   │   ├── prestashop.js  shopware.js  salesforce.js  bigcommerce.js
│   └── domHeuristics.js         # E6 — scoring dei candidati prezzo nel DOM
├── normalize/
│   ├── price.js                 # UNICA implementazione del parsing prezzo
│   ├── currency.js              # ISO-4217, simboli, locale
│   ├── availability.js          # enum normalizzato
│   ├── identity.js              # gtin/ean/mpn/sku/asin, URL canonico
│   └── variant.js               # chiave di variante stabile
├── score/
│   ├── confidence.js            # pesi per sorgente, accordo fra estrattori
│   └── validate.js              # plausibilità vs storico e vs candidati
├── recipe/
│   ├── store.js                 # load/save ricette (cache in-process + DB)
│   ├── learner.js               # deriva la ricetta dal run vincente
│   └── schema.js                # validazione (zod) del JSON di ricetta
├── policy/
│   ├── urlPolicy.js             # SSRF guard, canonicalizzazione, tracking params
│   ├── robots.js                # lettura e cache robots.txt
│   └── rateLimiter.js           # token bucket per dominio
└── telemetry.js                 # emissione di scrape_runs + metriche
```

`server/services/scrapers/*` viene **eliminato** al termine della fase 5 (vedi §14).

---

## 5. Modello dati — «i parametri dello scraper vivono a DB»

È il cuore di R2. Sette nuove tabelle + evoluzione di `products`.

### 5.1 `domain_profiles` — cosa sappiamo di un dominio

```sql
create table public.domain_profiles (
  id                uuid primary key default gen_random_uuid(),
  domain            text not null unique,          -- host normalizzato, senza www
  platform          text,                          -- shopify | woocommerce | magento | ...
  transport         text not null default 'auto',  -- auto | http | browser | browser_interactive
  requires_js       boolean not null default false,
  render_wait       jsonb,                         -- {"strategy":"selector","value":"[itemprop=price]","timeoutMs":8000}
  request_headers   jsonb not null default '{}'::jsonb,
  user_agent_class  text default 'desktop_chrome', -- desktop_chrome | mobile_safari | bot_friendly
  cookies           jsonb not null default '[]'::jsonb,  -- es. cookie banner / consenso / paese
  locale            text,                          -- it-IT
  default_currency  char(3),
  price_format      jsonb,                         -- {"decimal":",","group":".","currencyPosition":"prefix"}
  rate_limit_rpm    integer not null default 6,
  min_interval_ms   integer not null default 10000,
  robots_allowed    boolean,
  robots_checked_at timestamptz,
  anti_bot          text,                          -- none | cloudflare | akamai | datadome | perimeterx
  block_reason      text,                          -- se valorizzato il dominio è escluso
  blocked_until     timestamptz,
  success_count     integer not null default 0,
  failure_count     integer not null default 0,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

Sostituisce integralmente `supported_domains` (whitelist) con un modello *aperto per default,
chiuso per eccezione*.

### 5.2 `scrape_recipes` — la ricetta appresa

```sql
create table public.scrape_recipes (
  id             uuid primary key default gen_random_uuid(),
  domain         text not null,
  url_pattern    text not null default '*',   -- glob/regex: distingue PDP da varianti di percorso
  scope          text not null default 'domain',  -- domain | url_pattern | product
  product_id     uuid references public.products(id) on delete cascade, -- solo per scope=product
  version        integer not null default 1,
  status         text not null default 'active',  -- active | candidate | deprecated | quarantined
  origin         text not null default 'learned', -- learned | manual | seeded
  transport      text not null default 'http',
  render_wait    jsonb,
  headers        jsonb not null default '{}'::jsonb,
  pre_actions    jsonb not null default '[]'::jsonb,  -- click cookie banner, select variante, scroll
  fields         jsonb not null,               -- vedi 5.3: la mappa dei campi
  post_rules     jsonb not null default '{}'::jsonb,  -- regex/trim/moltiplicatori/blacklist
  confidence     numeric(4,3) not null default 0,
  success_count  integer not null default 0,
  failure_count  integer not null default 0,
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  learned_from_run uuid,                        -- FK logica a scrape_runs
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (domain, url_pattern, scope, product_id, version)
);

create index idx_scrape_recipes_lookup
  on public.scrape_recipes (domain, status, scope) where status = 'active';
```

**Versionamento:** una ricetta non viene mai mutata in place quando cambia strategia. Il
learner crea `version + 1` con `status='candidate'`; dopo N successi consecutivi (default 3)
diventa `active` e la precedente passa a `deprecated`. Questo dà rollback immediato e una
storia leggibile di come uno store è cambiato nel tempo.

### 5.3 Formato di `fields` — la parte che oggi è hardcoded

```jsonc
{
  "price": {
    "strategy": "jsonld",                       // jsonld | microdata | meta | appstate | css | regex | platform
    "path": "$..offers[?(@['@type']=='Offer')].price",
    "fallbacks": [
      { "strategy": "css", "selector": "[data-test=product-price] .value", "attr": "textContent" },
      { "strategy": "meta", "selector": "meta[property='product:price:amount']", "attr": "content" }
    ],
    "transform": ["trim", "stripCurrency", "localeNumber"],
    "exclude": ["del", "s", ".line-through", "[class*=strike]", "[class*=rate]", "[class*=mese]"],
    "confidence": 0.97
  },
  "currency":     { "strategy": "jsonld", "path": "$..priceCurrency", "default": "EUR" },
  "title":        { "strategy": "css", "selector": "h1", "transform": ["trim", "collapseWs"] },
  "image":        { "strategy": "meta", "selector": "meta[property='og:image']", "attr": "content" },
  "availability": { "strategy": "jsonld", "path": "$..availability", "map": { "InStock": "in_stock", "OutOfStock": "out_of_stock", "PreOrder": "preorder" } },
  "gtin":         { "strategy": "jsonld", "path": "$..gtin13" },
  "sku":          { "strategy": "jsonld", "path": "$..sku" },
  "brand":        { "strategy": "jsonld", "path": "$..brand.name" },
  "seller":       { "strategy": "css", "selector": "[data-test=seller-name]" },
  "condition":    { "strategy": "jsonld", "path": "$..itemCondition" },
  "variantKey":   { "strategy": "url", "path": "query.variant" },
  "specs":        { "strategy": "cssList", "selector": ".specs tr", "keySelector": "th", "valueSelector": "td" }
}
```

Nessun campo di questo JSON esiste nel codice: il codice sa solo *eseguire* `strategy`.
Aggiungere uno store significa aggiungere una riga a `scrape_recipes` — spesso senza che
nessuno la scriva a mano, perché la scrive il learner.

### 5.4 `scrape_runs` — audit di ogni singola esecuzione

```sql
create table public.scrape_runs (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid references public.products(id) on delete cascade,
  url            text not null,
  domain         text not null,
  recipe_id      uuid references public.scrape_recipes(id) on delete set null,
  recipe_version integer,
  trigger        text not null,          -- add_product | scheduled | manual_refresh | backfill
  transport_used text not null,
  tier_escalations integer not null default 0,
  status         text not null,          -- success | partial | failed | blocked | quarantined
  http_status    integer,
  duration_ms    integer,
  attempts       integer not null default 1,
  extractors_ran   jsonb not null default '[]'::jsonb,
  winning_source   text,                 -- jsonld | appstate | dom | recipe | ...
  candidates       jsonb not null default '[]'::jsonb,  -- tutti i candidati prezzo con score ed evidenza
  confidence       numeric(4,3),
  result           jsonb,                -- payload normalizzato
  validation       jsonb,                -- esito dei check di plausibilità
  error_code       text,                 -- CAPTCHA | TIMEOUT | DNS | HTTP_4XX | NO_PRICE | LOW_CONFIDENCE | ...
  error_message    text,
  html_hash        text,                 -- per deduplicare e riconoscere pagine invariate
  snapshot_path    text,                 -- storage, solo su fallimento o bassa confidenza
  created_at     timestamptz not null default now()
);

create index idx_scrape_runs_product_time on public.scrape_runs (product_id, created_at desc);
create index idx_scrape_runs_domain_status on public.scrape_runs (domain, status, created_at desc);
```

Retention: 90 giorni per i run `success`, 365 per `failed`/`quarantined` (job di pulizia).

### 5.5 `product_offers` — la variante è l'unità di tracking

```sql
create table public.product_offers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  offer_key     text not null,      -- hash stabile di (variante, venditore, condizione)
  variant       jsonb not null default '{}'::jsonb,  -- {"taglia":"42","colore":"nero","memoria":"256GB"}
  seller        text,
  condition     text,               -- new | refurbished_a | refurbished_b | used | ...
  gtin          text,
  sku           text,
  url           text,               -- deep link alla variante, se esiste
  is_primary    boolean not null default false,   -- l'offerta seguita di default
  current_price numeric(12,2),
  currency      char(3),
  availability  text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (product_id, offer_key)
);
```

**Perché è essenziale.** Oggi la storia prezzi di un iPhone su BackMarket mescola «256 GB
grado A» e «128 GB grado C» a seconda di cosa la pagina mostrava per prima: il grafico
mostra crolli e rimbalzi che non sono mai avvenuti. Con `product_offers` ogni serie storica
è coerente con sé stessa, e questo è la precondizione di R3.

### 5.6 `price_observations` — ogni check lascia traccia

```sql
create table public.price_observations (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  offer_id      uuid references public.product_offers(id) on delete cascade,
  run_id        uuid references public.scrape_runs(id) on delete set null,
  price         numeric(12,2),
  currency      char(3),
  availability  text,
  confidence    numeric(4,3),
  accepted      boolean not null default true,   -- false = quarantena, non entra nella storia
  reject_reason text,
  observed_at   timestamptz not null default now()
);

create index idx_price_obs_offer_time on public.price_observations (offer_id, observed_at desc);
```

`price_history` resta come **vista/derivato** dei soli change point accettati, per non
rompere il client e i grafici esistenti:

```sql
create view public.price_history_v as
select distinct on (offer_id, price_change_group) ...   -- change points da price_observations
```

Nella fase di transizione la tabella `price_history` continua a essere popolata in parallelo
(dual write) finché il client non punta alla vista.

### 5.7 `scrape_field_feedback` — human in the loop

```sql
create table public.scrape_field_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid references public.products(id) on delete cascade,
  domain      text not null,
  field       text not null,           -- price | title | image | availability
  reported    text not null,           -- wrong | missing | correct
  expected_value text,                 -- l'utente può digitare il prezzo giusto
  run_id      uuid references public.scrape_runs(id) on delete set null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
```

Un «questo prezzo è sbagliato, il vero prezzo è 249,90» dall'UI diventa un input diretto del
learner: la prossima discovery cerca il candidato che *matcha il valore atteso* e promuove
quella strategia a ricetta. È il meccanismo di recupero per i casi che l'euristica sbaglia.

### 5.8 `scrape_jobs` — coda di lavoro

```sql
create table public.scrape_jobs (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references public.products(id) on delete cascade,
  url          text not null,
  domain       text not null,
  priority     integer not null default 100,   -- più basso = prima
  trigger      text not null,
  status       text not null default 'pending',-- pending | claimed | done | failed | dead
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  claimed_by   text,
  claimed_at   timestamptz,
  run_after    timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now()
);

create index idx_scrape_jobs_claimable
  on public.scrape_jobs (status, run_after, priority) where status = 'pending';
```

Claim atomico via RPC `claim_scrape_jobs(worker_id text, batch int, domains text[])` con
`for update skip locked`, in modo che più invocazioni concorrenti non si pestino i piedi.

### 5.9 Modifiche a `products`

```sql
alter table public.products
  add column if not exists canonical_url   text,
  add column if not exists domain          text,
  add column if not exists store           text,
  add column if not exists details         jsonb not null default '{}'::jsonb,
  add column if not exists availability    text,
  add column if not exists primary_offer_id uuid references public.product_offers(id),
  add column if not exists gtin            text,
  add column if not exists sku             text,
  add column if not exists brand           text,
  add column if not exists tracking_health text not null default 'unknown',
      -- healthy | degraded | broken | blocked
  add column if not exists last_success_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0;
```

`store`, `details` e `availability` vengono così **formalizzati** (oggi esistono solo in
produzione, fuori da `schema.sql` — vedi D14).

### 5.10 Grants e RLS

Tutte le nuove tabelle: RLS abilitata.

- `products`, `product_offers`, `price_observations`, `scrape_field_feedback`, `scrape_jobs`
  → policy su `auth.uid()` risalendo a `products.user_id`; `grant` a `authenticated`.
- `scrape_recipes`, `domain_profiles`, `scrape_runs` → **scrittura solo `service_role`**;
  lettura per `authenticated` limitata ai campi non sensibili (niente `headers`, `cookies`)
  tramite vista dedicata. Le ricette sono infrastruttura condivisa, non dato utente.
- Nessun grant a `anon` su nessuna nuova tabella.

---

## 6. Il ciclo di apprendimento della ricetta

```
   ┌──────────────┐   miss    ┌────────────────┐   successo   ┌──────────────────┐
   │ Recipe lookup├──────────►│   DISCOVERY    ├─────────────►│  RecipeLearner   │
   │ (domain,url) │           │ pipeline piena │              │ upsert vN+1      │
   └──────┬───────┘           └────────┬───────┘              │ status=candidate │
          │ hit                        │ fallimento           └────────┬─────────┘
          ▼                            ▼                               │ 3 successi
   ┌──────────────┐            ┌───────────────┐                       ▼
   │  FAST PATH   │  fallisce  │  quarantena   │                ┌──────────────┐
   │ applica vN   ├───────────►│  + alert      │                │ status=active│
   └──────┬───────┘  o low     └───────────────┘                │ vN-1 → deprec│
          │ conf. conferma                                      └──────────────┘
          ▼
   success_count++ , confidence ricalcolata
```

**Regole operative**

| Evento | Azione |
|--------|--------|
| Ricetta assente per il dominio | Discovery completa (tutti gli estrattori), costo massimo consentito |
| Ricetta presente, fast path OK, confidenza ≥ soglia | Accetta, `success_count++`, nessun costo aggiuntivo |
| Fast path fallisce o confidenza < soglia | Esegui discovery nello **stesso run**; se la discovery trova un risultato valido → nuova versione candidate |
| 3 fallimenti consecutivi della ricetta attiva | `status='quarantined'`, il dominio torna in discovery permanente, alert |
| Discovery fallisce del tutto | `scrape_runs.status='failed'`, `products.tracking_health='broken'`, retry con backoff, nessuna scrittura di prezzo |
| Feedback utente «prezzo sbagliato» | Discovery forzata orientata al valore atteso; ricetta risultante `origin='manual'`, priorità massima |

**Cosa viene appreso esattamente** (= «tutti i parametri dello scraper» del requisito):
transport tier, wait strategy, headers/UA class, cookie necessari, azioni preliminari
(chiusura cookie banner, selezione variante), la strategia e il percorso per **ogni** campo,
le trasformazioni, i selettori di esclusione, il formato numerico e la valuta, la confidenza
e le statistiche. Tutto in `scrape_recipes` + `domain_profiles`.

---

## 7. Il motore di estrazione in dettaglio

Gli estrattori girano **tutti** in discovery e producono *candidati*, non risultati. Ogni
candidato porta: valore, sorgente, percorso/selettore, evidenza testuale, peso base.

### E0 — LearnedRecipeExtractor
Applica la ricetta a DB. Peso base 0,95 se la ricetta ha `success_count ≥ 5`, 0,80 altrimenti.
In fast path è l'unico a girare.

### E1 — JSON-LD (`application/ld+json`)
Copre la maggioranza degli e-commerce moderni. Deve gestire i casi che gli scraper attuali
ignorano: array di root, `@graph`, `Product` annidato in `ItemPage`/`BreadcrumbList`,
`offers` come oggetto **o** array, `AggregateOffer` (`lowPrice`/`highPrice` → si prende
`lowPrice` e si marca `is_range=true`), `hasVariant`, `priceSpecification` con
`UnitPriceSpecification` (da **escludere** quando `referenceQuantity` ≠ 1, è il prezzo al kg),
JSON malformato (parser tollerante), `@id` referenziati. Peso base 0,90.

### E2 — Microdata / RDFa
`itemtype="…/Product"`, `itemprop="price|priceCurrency|availability"`, `content` vs testo.
Peso base 0,80.

### E3 — Meta tag
`product:price:amount`, `og:price:amount`, `twitter:data1`, `itemprop` su `<meta>`.
Peso base 0,65 — attenzione: spesso stantii o riferiti alla variante di default.

### E4 — AppState
`__NEXT_DATA__`, `window.__NUXT__`, `__INITIAL_STATE__`, `window.dataLayer` (GA4
`view_item` → `items[0].price` è affidabilissimo), Apollo `__APOLLO_STATE__`, Redux preload,
`ShopifyAnalytics.meta`, `x-magento-init`. Ricerca **per struttura**, non per percorso fisso:
walk ricorsivo che cerca oggetti con chiavi `price|amount|value` + `currency|currencyCode`
adiacenti, con preferenza per rami che contengono anche `sku|productId|variantId`.
Peso base 0,85.

### E5 — Platform adapters
Rilevamento della piattaforma da fingerprint (header `x-shopid`, path `/cdn/shop/`,
`wp-content/plugins/woocommerce`, `Mage.Cookies`, `/on/demandware.store/`, meta generator).
Ogni piattaforma ha un **endpoint canonico**:

| Piattaforma | Sorgente affidabile |
|---|---|
| Shopify | `{product-url}.js` e `.json` → prezzo in centesimi, tutte le varianti, disponibilità per variante |
| WooCommerce | `<form class="cart">` `data-product_variations` + Store API `/wp-json/wc/store/v1/products/{id}` |
| Magento 2 | `x-magento-init` → `[data-role=priceBox]`, `spConfig` per le varianti |
| PrestaShop | `window.prestashop.product` |
| Shopware 6 | `data-product-information`, Store API |
| Salesforce B2C | `data-pid`, `dwAnalytics` payload |
| BigCommerce | `__BCData` |

Questo è ciò che rende realistico l'obiettivo «qualunque shop»: la coda lunga degli shop
italiani gira quasi tutta su Shopify, WooCommerce o PrestaShop. Peso base 0,93 (endpoint
strutturati) — spesso **superiore** al JSON-LD perché espone le varianti.

### E6 — Euristiche DOM
Ultima risorsa, ma è quella che salva gli shop artigianali. Algoritmo:

1. **Raccolta**: tutti i nodi di testo che matchano una regex prezzo multi-locale
   (`€`, `EUR`, `$`, `£`, `CHF`, prefisso o suffisso, separatori `.`/`,`/spazio/apostrofo).
2. **Filtri di esclusione** (i falsi positivi che oggi ci fregano):
   - dentro `del`, `s`, `strike`, o con `text-decoration: line-through` computato → prezzo barrato
   - testo circostante con `spedizione|shipping|consegna|IVA esclusa|al mese|/mese|rata|finanziamento|a partire da|da €|risparmi|sconto di`
   - unità di misura adiacenti (`/kg`, `/l`, `al pezzo`, `cad.`)
   - nodi nascosti (`display:none`, `visibility:hidden`, `offsetParent === null`)
   - nodi dentro sezioni «prodotti correlati / potrebbe interessarti / recensioni / carrello»
3. **Scoring** di ogni candidato rimasto:

   | Segnale | Peso |
   |---|---|
   | Prossimità DOM al bottone «Aggiungi al carrello» (distanza in antenati comuni) | +0,25 |
   | Dentro un container con `class/id/data-*` che contiene `price` (e non `old|was|list|strike`) | +0,20 |
   | `font-size` fra i più grandi della pagina | +0,15 |
   | Posizione: sopra la piega, nella metà superiore | +0,10 |
   | Accordo con la valuta dichiarata in `domain_profiles`/meta | +0,10 |
   | Coerenza con l'ultimo prezzo noto del prodotto (entro ±40%) | +0,20 |
   | Unicità: nessun altro candidato con score simile | +0,10 |
   | Presenza di un secondo candidato barrato **superiore** (pattern sconto classico) | +0,15 |

4. Il candidato con score massimo vince; se il primo e il secondo distano < 0,10 →
   confidenza abbassata e, se sotto soglia, quarantena.

Peso base 0,55 — mai sufficiente da solo per un *primo* salvataggio ad alta confidenza senza
almeno un segnale di conferma (§8.2).

---

## 8. Normalizzazione, riconciliazione, validazione

### 8.1 Normalizzazione

- **Prezzo** — una sola implementazione, `server/scrape/normalize/price.js`, che sostituisce
  le tre attuali (D5). Regole: rileva il separatore decimale dall'ultimo separatore seguito da
  1-2 cifre; gestisce `1'234.56` (CH), `1 234,56` (FR), `1.234,56` (IT), `1,234.56` (EN),
  `1234` (nessun separatore); gestisce i centesimi interi (Shopify: `12990` + `"cents"`);
  rifiuta valori `≤ 0`, `> 10.000.000`, o con più di 2 decimali quando non è un prezzo unitario.
  **Il valore a DB è `numeric(12,2)`, mai stringa.**
- **Valuta** — ISO-4217. Mappa simbolo→codice ambigua (`$` → dipende dal TLD/locale del
  dominio: `.ca` → CAD, `.au` → AUD, default USD; `kr` → SEK/NOK/DKK dal TLD). Se ambigua e
  non risolvibile → confidenza penalizzata di 0,15.
- **Disponibilità** — enum `in_stock | out_of_stock | preorder | backorder | discontinued | unknown`.
  Mai booleano (oggi `available` è booleano e «non lo so» diventa `false`).
- **Identità** — `canonical_url` da `<link rel=canonical>` ripulito dei parametri di tracking
  (`utm_*`, `gclid`, `fbclid`, `ref`, `tag`…) ma **conservando** i parametri di variante
  (`variant`, `sku`, `color`, `size`, `dwvar_*`). Identificatori: GTIN/EAN/UPC, MPN, SKU, ASIN.
- **Variante** — `offer_key = sha1(variant_normalized + seller + condition)`; se la pagina
  non espone varianti, `offer_key = 'default'`.

### 8.2 Riconciliazione e confidenza

```
confidence = clamp(0..1,
    peso_base_sorgente_vincente
  + 0.10 * (numero di sorgenti indipendenti che concordano entro 1 centesimo)
  + 0.05 * (valuta confermata da ≥ 2 sorgenti)
  - 0.20 * (esiste un candidato con score comparabile ma valore diverso)
  - 0.25 * (nessun titolo o nessuna immagine estratti → pagina probabilmente non è una PDP)
  - 0.30 * (segnali anti-bot rilevati nella pagina)
)
```

Soglie (configurabili in `domain_profiles`, default globali):

| Confidenza | Comportamento |
|---|---|
| ≥ 0,85 | Accetta: scrive prezzo, aggiorna/crea ricetta |
| 0,60 – 0,85 | Accetta il prezzo **solo se** supera i check di plausibilità §8.3; ricetta resta `candidate` |
| < 0,60 | **Quarantena**: `price_observations.accepted=false`, `current_price` invariato, run marcato `quarantined`, alert se ripetuto |

### 8.3 Check di plausibilità (la garanzia di R3)

Prima di scrivere un prezzo si applicano, in ordine:

1. **Range assoluto**: `0 < price ≤ 10.000.000` e coerente con la valuta.
2. **Delta vs storico**: variazione > 60% rispetto alla mediana delle ultime 5 osservazioni
   accettate → non rifiutata a priori, ma richiede confidenza ≥ 0,90 **oppure** conferma con
   un secondo fetch a distanza di ≥ 60 s (double-check). Un crollo reale (Black Friday) passa
   al secondo fetch; un errore di selettore quasi mai.
3. **Coerenza di valuta**: cambio di valuta rispetto allo storico senza cambio di dominio →
   quarantena (tipico sintomo di geo-redirect o di selettore che ha preso un altro blocco).
4. **Coerenza di identità**: se GTIN/SKU estratti ≠ quelli storici del prodotto → l'URL
   punta ora a un altro prodotto (redirect, prodotto ritirato) → non si scrive prezzo,
   `tracking_health='degraded'` e notifica all'utente.
5. **Anti-flapping**: due osservazioni che alternano A→B→A→B entro 24 h con confidenza < 0,9
   indicano estrazione instabile (A/B test dello store o variante non fissata) → quarantena
   della ricetta.
6. **Sanity di disponibilità**: `out_of_stock` + prezzo presente è lecito; `in_stock` senza
   prezzo non lo è → `partial`.

**Regola d'oro:** un fallimento non scrive mai nulla su `current_price`. Oggi invece un
`continue` silenzioso (D8) lascia credere che il prezzo sia stabile.

---

## 9. Fetch layer

### 9.1 Escalation dei tier

| Tier | Come | Quando | Costo |
|---|---|---|---|
| 0 | `undici` GET + `cheerio` | Default per un dominio nuovo | ~200 ms |
| 1 | Come 0 + header realistici, `Accept-Language` dal locale, cookie salvati, HTTP/2 | Se tier 0 → 403 o HTML privo di segnali prodotto | ~300 ms |
| 2 | Puppeteer headless, blocco di immagini/font/media, `domcontentloaded` + wait strategy | Se tier 1 non produce candidati o il dominio è marcato `requires_js` | 4-12 s |
| 3 | Puppeteer + `pre_actions` (chiusura banner, selezione variante, scroll, attesa XHR) | Solo se la ricetta lo richiede | 8-20 s |

Il tier che ha funzionato viene scritto in `domain_profiles.transport` e in
`scrape_recipes.transport`: dalla seconda volta si parte direttamente da lì (fine di D12).

### 9.2 Sicurezza e correttezza dell'URL (sostituisce la whitelist, D1)

`policy/urlPolicy.js`:
- solo `http`/`https`; no credenziali nell'URL; lunghezza massima
- **SSRF guard**: risoluzione DNS e rifiuto di IP privati/loopback/link-local/metadata
  (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`),
  **ri-verificata dopo ogni redirect** (max 5 redirect)
- limite di dimensione della risposta (5 MB) e `content-type` testuale
- timeout globale per run (30 s tier 0-1, 45 s tier 2-3)
- canonicalizzazione e stripping dei parametri di tracking
- blocklist da `domain_profiles.block_reason` (dominio che ha chiesto di non essere
  scrapato, o che ci blocca sistematicamente)

### 9.3 Buon vicinato

- `robots.txt` letto e cachato (24 h) in `domain_profiles`; se `Disallow` sul path →
  `blocked`, il prodotto non viene tracciato e l'utente vede il motivo. Configurabile via
  `SCRAPE_RESPECT_ROBOTS` (default `true`).
- Rate limiter per dominio (token bucket, `rate_limit_rpm`, default 6/min) condiviso fra
  tutti gli utenti.
- `User-Agent` identificabile con URL di contatto sul tier 0/1 quando `robots` è permissivo;
  UA browser realistici solo dove necessario (riuso di `userAgentManager`).
- Backoff progressivo su 429/503 con rispetto di `Retry-After`; `blocked_until` a DB.
- **Nota**: lo scraping di alcuni store viola i loro ToS. La blocklist a DB e il rispetto di
  robots sono il meccanismo con cui rimuoviamo un dominio su richiesta.

### 9.4 Anti-bot
`captchaDetector` e `proxyManager` esistenti vengono conservati e spostati sotto
`server/scrape/fetch/`. Novità: l'esito della detection finisce in `scrape_runs.error_code`
e in `domain_profiles.anti_bot`, così sappiamo quali domini richiedono proxy residenziali
prima ancora di provarci.

---

## 10. Orchestrazione e scheduling

Sostituisce il loop monolitico (D10, D11).

```
Netlify scheduled function  "dispatcher"   (*/10 * * * *)
   └─ seleziona i prodotti la cui prossima verifica è dovuta
      (intervallo utente, backoff su prodotti in errore, priorità)
   └─ inserisce job in scrape_jobs (dedup su product_id+pending)

Netlify background function "worker"       (invocata dal dispatcher, N istanze)
   └─ claim_scrape_jobs(worker_id, batch=10)
   └─ per ogni job: orchestrator.scrapeUrl() → persistenza → notifiche
   └─ rispetta il rate limit per dominio; ri-accoda se il bucket è vuoto
   └─ si auto-invoca se restano job e il tempo residuo < soglia
```

- **Adaptive scheduling**: prodotti con prezzo volatile → check più frequenti; prodotti
  fermi da 30 giorni → intervallo raddoppiato (max 24 h); prodotti in `broken` → backoff
  esponenziale fino a 48 h, poi notifica all'utente.
- `price_check_interval` finalmente rispettato e con **unità esplicita**: si migra la colonna a
  `price_check_interval_minutes` con backfill `valore * 60` (fix di D9).
- `server/index.js` mantiene `node-cron` **solo** in sviluppo (`if (process.env.NODE_ENV !== 'production')`),
  chiamando lo stesso dispatcher (fix di D10).
- Riuso del browser fra job nella stessa invocazione (`browserPool`) — oggi si apre e chiude
  Chromium per ogni singolo prodotto.

---

## 11. API e contratti

### `POST /api/scrape`
```jsonc
// request
{ "url": "https://…", "productId": "uuid|null", "force": false }

// response 200
{
  "ok": true,
  "product": {
    "canonicalUrl": "…", "domain": "…", "store": "…",
    "title": "…", "image": "…", "description": "…",
    "brand": "…", "gtin": "…", "sku": "…",
    "specs": { "…": "…" }
  },
  "offers": [
    { "offerKey": "…", "variant": {"memoria":"256GB"}, "seller": "…", "condition": "refurbished_a",
      "price": 429.00, "currency": "EUR", "availability": "in_stock", "isPrimary": true }
  ],
  "confidence": 0.93,
  "source": "platform:shopify",
  "recipe": { "id": "…", "version": 4, "status": "active", "learned": false },
  "runId": "…"
}

// response 422 — pagina letta ma prezzo non affidabile
{ "ok": false, "code": "LOW_CONFIDENCE", "confidence": 0.41,
  "candidates": [ {"value": 429.0, "source": "dom", "evidence": "…"} ],
  "message": "Prezzo non determinato con sicurezza", "runId": "…" }
```

Nuovi endpoint:
- `POST /api/products/:id/refresh` — refresh manuale **lato server** (oggi lo fa il client, D15)
- `POST /api/products/:id/offers/:offerId/select` — scegli quale variante seguire
- `POST /api/feedback` — segnalazione «prezzo sbagliato / prezzo giusto è X»
- `GET /api/products/:id/health` — stato tracking, ultimo run, motivo dell'eventuale errore
- `GET /api/admin/recipes?domain=` — ispezione ricette (solo service role / utente admin)

**Contratto di compatibilità:** la risposta mantiene anche i campi piatti `title`, `image`,
`description`, `price`, `currency`, `store`, `details`, `available` (dall'offerta primaria)
finché il client non è migrato, così le fasi 1-4 non rompono la UI.

---

## 12. Impatti sul client

| Area | Cambiamento |
|---|---|
| `Layout.jsx` (aggiunta prodotto) | Smette di scrivere su `products`: chiama `POST /api/products` e riceve il prodotto già persistito (chiude D15) |
| `ProductDetail.jsx` (refresh) | Chiama `POST /api/products/:id/refresh` invece di fare scrape + scrittura DB |
| `client/src/lib/utils.js` | `parsePrice` **rimossa**: il prezzo arriva già numerico dal server (chiude D5) |
| Nuovo | Selettore di variante quando `offers.length > 1`, con indicazione di quale è seguita |
| Nuovo | Badge di *tracking health* sulla card prodotto (verde/giallo/rosso) + tooltip con l'ultimo errore |
| Nuovo | Bottone «il prezzo non è corretto» → `POST /api/feedback` |
| `Settings.jsx` | La pagina «domini supportati» diventa «domini bloccati / stato domini» alimentata da `domain_profiles` |
| Grafico | Serie per offerta selezionata; punti a bassa confidenza mostrati tratteggiati o esclusi |

---

## 13. Testing

Oggi: zero test (D16). Il motore non è refactorabile in sicurezza senza rete di protezione.

| Livello | Strumento | Contenuto |
|---|---|---|
| **Fixture / golden** | Vitest + snapshot HTML salvati in `server/scrape/__fixtures__/{domain}/{case}.html` | ≥ 60 pagine reali salvate (con relativo `expected.json`). **Nessuna rete nei test.** Ogni bug di estrazione entra come nuova fixture |
| **Unit** | Vitest | `normalize/price.js` con ≥ 50 casi di formato; `currency.js`; `variant.js`; scoring; validator |
| **Pipeline** | Vitest | Data una fixture → il candidato vincente e la confidenza attesi |
| **Recipe round-trip** | Vitest | Discovery su fixture → ricetta generata → riapplicata alla stessa fixture → stesso risultato. È il test che garantisce che «i parametri salvati a DB» siano davvero sufficienti |
| **Regressione ricette** | Vitest | Ricette reali esportate dalla produzione, rieseguite sulle fixture corrispondenti |
| **API** | Supertest | `/api/scrape` con URL validi, SSRF, domini bloccati, low confidence |
| **Live canary** | job notturno, non in CI | 20 URL reali; misura success rate e confidenza; alert se scende sotto soglia. È l'unico test che tocca la rete |
| **E2E** | Playwright | Aggiungi prodotto → vedi prezzo → refresh → grafico |

Target di copertura: ≥ 80% su `server/scrape/**`, ≥ 60% globale.
CI (GitHub Actions): lint + unit + fixture su ogni PR; canary schedulato.

---

## 14. Piano di migrazione a fasi

Ogni fase è mergeable e reversibile. Nessuna fase rompe la produzione.

### Fase 0 — Fondamenta (½ settimana)
- Sistema di migrazioni (`server/database/migrations/` numerate + runner idempotente)
- Allineamento di `schema.sql` alla realtà di produzione (`store`, `details`, `available`) — D14
- Vitest + primo set di fixture (10 pagine)
- **Fix immediati a basso rischio:** D4 (`priceEl`), D9 (`price_check_interval`), D13 (path Chrome)
- ✅ *Exit*: `npm test` verde, migrazioni riproducibili da zero

### Fase 1 — Normalizzazione unica (½ settimana)
- `server/scrape/normalize/*` con la sola implementazione di `parsePrice` + currency + availability
- Gli scraper esistenti vengono ricablati su di essa; `client/src/lib/utils.js` deprecato
- ✅ *Exit*: 50 test di formato prezzo verdi; nessuna regressione sui prodotti esistenti

### Fase 2 — Pipeline generica in shadow mode (1,5 settimane)
- `fetch/` (tier 0-2), `extract/` (E1-E4, E6), `score/`, `Document`
- La pipeline gira **in parallelo** agli scraper attuali senza scrivere prezzi:
  ogni run confronta vecchio vs nuovo e logga la differenza in `scrape_runs`
- ✅ *Exit*: sui prodotti reali in produzione, la pipeline generica concorda con lo scraper
  dedicato ≥ 95% delle volte, e nel restante 5% è la pipeline ad avere ragione nei casi
  ispezionati manualmente

### Fase 3 — Persistenza delle ricette (1 settimana) ← **il cuore di R2**
- Tabelle `domain_profiles`, `scrape_recipes`, `scrape_runs` + RLS/grants
- `recipe/learner.js` + `recipe/store.js` + fast path E0
- Seed: le 13 classi attuali vengono **convertite in righe di ricetta** (`origin='seeded'`),
  non riscritte in codice
- ✅ *Exit*: per ogni store oggi supportato esiste una ricetta a DB che produce lo stesso
  risultato della classe corrispondente sulla fixture; test di round-trip verde

### Fase 4 — Offerte, osservazioni, validazione (1 settimana) ← **il cuore di R3**
- `product_offers`, `price_observations`, viste di compatibilità, dual write su `price_history`
- Validator di plausibilità, quarantena, `tracking_health`
- Backfill: per ogni prodotto esistente si crea l'offerta `default` e si migra lo storico
- ✅ *Exit*: nessun prezzo scritto sotto soglia; ogni check produce un'osservazione;
  zero falsi positivi sul panel

### Fase 5 — Switch e rimozione della whitelist (1 settimana)
- La pipeline diventa il percorso primario; `services/scrapers/*` **eliminata**
- `validateProductUrl` sostituita da `urlPolicy` + `domain_profiles` (fine di D1/D2)
- Platform adapters E5 (Shopify, Woo, PrestaShop, Magento)
- ✅ *Exit*: un URL di uno shop mai visto viene aggiunto e tracciato correttamente;
  KPI di §1.1 raggiunti sul panel

### Fase 6 — Coda, worker, scheduling adattivo (1 settimana)
- `scrape_jobs`, RPC di claim, dispatcher + worker, browser pool, rate limiting per dominio
- Rimozione del doppio scheduler (D10, D11)
- ✅ *Exit*: 500 prodotti simulati controllati entro la finestra prevista, nessun timeout

### Fase 7 — UI, feedback, osservabilità (1 settimana)
- Selettore variante, badge health, bottone «prezzo sbagliato», pagina stato domini
- Dashboard metriche + alert (success rate per dominio, ricette in quarantena, confidenza media)
- ✅ *Exit*: un errore di estrazione è visibile all'utente e correggibile in < 1 minuto

**Totale stimato: ~7,5 settimane/uomo.** Fasi 0-2 e 3-4 sono i due blocchi non frazionabili.

---

## 15. Osservabilità

Metriche esportate (log strutturati JSON + tabella di aggregazione giornaliera):

- `scrape.success_rate` per dominio, per tier, per sorgente vincente
- `scrape.confidence` p50/p10 per dominio
- `scrape.duration_ms` p50/p95 per tier
- `scrape.tier_escalation_rate` — quanto spesso paghiamo il browser
- `recipe.learned_total`, `recipe.quarantined_total`, `recipe.age_days` p50
- `price.quarantined_ratio`, `price.anomaly_detected`
- `product.tracking_health` distribuzione

Alert:
- success rate di un dominio < 50% su 10 run consecutivi
- ricetta in quarantena
- > 5% delle osservazioni globali quarantenate in 24 h
- un prodotto in `broken` da > 72 h → notifica all'utente proprietario

---

## 16. Rischi e mitigazioni

| Rischio | Prob. | Impatto | Mitigazione |
|---|---|---|---|
| L'euristica DOM sbaglia prezzo su shop minori | Alta | Alto | Soglie di confidenza + quarantena + feedback utente + doppio fetch sulle variazioni forti |
| Anti-bot (Cloudflare/DataDome) blocca domini popolari | Alta | Medio | Tier escalation, `anti_bot` a DB, proxy opzionali, e — quando il blocco è definitivo — stato `blocked` visibile all'utente invece di dati falsi |
| Costo/timeout su Netlify Functions con Chromium | Media | Alto | Tier 0/1 di default (≥ 70% dei check senza browser), coda + background functions, browser pool |
| Regressioni durante lo switch | Media | Alto | Shadow mode di Fase 2 con confronto vecchio/nuovo prima di qualunque cutover |
| Le ricette apprese «imparano male» e si consolidano | Media | Alto | Stato `candidate` finché non ci sono 3 successi; versionamento con rollback; validazione incrociata con lo storico |
| Aspetti legali/ToS con l'apertura a qualunque dominio | Media | Medio | robots.txt rispettato di default, rate limit conservativi, blocklist a DB, UA identificabile |
| Migrazione dati storici incoerente | Bassa | Medio | Dual write + viste di compatibilità; il backfill è idempotente e ripetibile |

---

## 17. Decisioni da confermare

1. **robots.txt**: rispettarlo di default (proposta: **sì**, con override per dominio)?
2. **Snapshot HTML** dei run falliti su Supabase Storage: quanto conservare (proposta: 14 giorni,
   solo `failed`/`quarantined`)?
3. **Multi-valuta**: convertire in una valuta di riferimento per i grafici o mostrare sempre
   l'originale (proposta: mostrare l'originale, conversione solo come label)?
4. **Proxy residenziali** a pagamento per i domini con anti-bot forte: dentro o fuori scope?
5. **`price_history`**: sostituirla con la vista subito dopo la Fase 4 o mantenere il dual
   write a lungo termine?
6. **Admin UI** delle ricette: pagina dedicata o solo ispezione via API?

---

## 18. Appendice — inventario delle modifiche

**Da creare**: tutto `server/scrape/**` (§4.1), migrazioni `002`–`010`, `server/scrape/__fixtures__/**`,
funzioni Netlify `dispatcher.js` e `worker.js`, componenti client `VariantSelector`,
`TrackingHealthBadge`, `PriceFeedbackButton`.

**Da modificare**: `server/index.js` (cron solo in dev, nuovi endpoint), `netlify/functions/api.js`
(nuove route, rimozione del workaround Buffer una volta corretto il body parsing),
`netlify.toml` (schedule dispatcher), `server/config/env.js` (nuove variabili:
`SCRAPE_RESPECT_ROBOTS`, `SCRAPE_MAX_TIER`, `SCRAPE_CONFIDENCE_THRESHOLD`,
`SCRAPE_WORKER_BATCH`, `SCRAPE_SNAPSHOT_BUCKET`), `client/src/components/Layout.jsx`,
`client/src/pages/ProductDetail.jsx`, `client/src/pages/Dashboard.jsx`,
`client/src/pages/Settings.jsx`, `schema.sql`.

**Da eliminare** (a fine Fase 5): `server/services/scrapers/` (13 classi + factory),
`server/services/scraper.js` (assorbito da `scrape/fetch/browserFetcher.js`),
`ALLOWED_DOMAINS` e `validateProductUrl` in `server/utils/validation.js`,
tabella `supported_domains`, `parsePrice` in `client/src/lib/utils.js` e in
`server/services/priceTracker.js`.

**Da spostare**: `server/utils/{captchaDetector,proxyManager,userAgentManager}.js`
→ `server/scrape/fetch/`.

---

## 19. Nota per una versione futura — integrazione Claude API

> **Non fa parte di questo refactor.** Le fasi 0-7 vanno completate senza LLM nel motore.
> Questa sezione registra la valutazione fatta, perché l'architettura a ricette è
> deliberatamente predisposta per ospitarla dopo, senza modifiche strutturali.

### 19.1 Il vincolo economico

Un LLM che **legge il prezzo a ogni check** è escluso. Con 500 prodotti × 4 check/giorno
si arriva a ~60.000 pagine/mese; una pagina ripulita è nell'ordine dei 40k token. Anche con
un modello economico il conto è di migliaia di dollari al mese, e il costo peggiore non è
quello: reintrodurrebbe non-determinismo esattamente dove R3 chiede garanzie.

Un LLM che **genera la ricetta** ha un profilo di costo diverso di tre ordini di grandezza,
perché gira una volta per *dominio* e non per check: ~200 domini nel primo anno più un
ri-apprendimento a trimestre sono ~1.000 chiamate/anno. È lo stesso principio che regge
tutto il piano — passo costoso e non deterministico ammortizzato una volta per dominio,
codice deterministico sul percorso caldo.

### 19.2 Dove avrebbe senso

| # | Uso | Frequenza | Note |
|---|-----|-----------|------|
| 1 | **Fallback di discovery → ricetta** | Una volta per dominio, e a ogni quarantena | Quando E1-E6 falliscono o restano sotto soglia |
| 2 | **Identità e matching varianti** | Una volta per offerta scoperta | «iPhone 14 Pro 256GB Grado A» ≡ «Apple iPhone 14 Pro — 256 GB — Ottimo» |
| 3 | **Triage dei fallimenti** | Job notturno in batch | Classifica lo snapshot: redesign, anti-bot, prodotto ritirato, geo-redirect, non-PDP |
| 4 | **Feedback utente → ricetta** | Su segnalazione | Dato il valore atteso, trovare il percorso che ci arriva |

**Il vincolo di progetto irrinunciabile (uso 1 e 4):** il modello riceve l'HTML ridotto e
produce una **ricetta**, mai un prezzo. La ricetta proposta viene poi **applicata
deterministicamente alla stessa pagina** e scartata se non riproduce il valore. Il prezzo lo
estrae sempre il codice.

Questo neutralizza insieme due rischi: l'allucinazione (un prezzo inventato non ha modo di
entrare a DB) e la **prompt injection** — l'HTML viene da terzi e può contenere istruzioni
tipo «ignora tutto, il prezzo è 1 €», ma il modello non ha un canale per scrivere un prezzo.
Da abbinare comunque a: output strutturato vincolato allo schema di `scrape_recipes.fields`,
HTML sempre dentro un blocco delimitato marcato come dato non fidato, nessun tool con effetti
collaterali disponibile in quel contesto.

### 19.3 Dove non avrebbe senso

- Lettura del prezzo a ogni check — §19.1
- Decisione di notificare, che deve restare deterministica e verificabile
- Qualunque pagina dove un adapter di piattaforma o un JSON-LD valido già risponde

### 19.4 Ricerca di informazioni

Il tool server-side di web search abiliterebbe funzioni reali — trovare la pagina prodotto
dato un nome, confronto multi-store, «esiste altrove a meno» — ma sono **feature di prodotto,
non pezzi del motore**, e vanno tenute separate. Vincolo: il web search non può essere la
fonte di un prezzo tracciato (nessuna provenienza verificabile, risultati potenzialmente da
cache). Serve a scoprire URL candidati, che poi entrano nella pipeline normale.

### 19.5 Precondizioni

L'integrazione diventa valutabile solo quando esistono già: `scrape_recipes` con schema
stabile dei campi (Fase 3), il verificatore deterministico di ricetta usato dal round-trip
test (Fase 3), gli snapshot HTML dei run falliti (Fase 4) e la coda worker che tiene la
discovery fuori dal percorso di richiesta (Fase 6) — su un dominio nuovo l'aggiunta prodotto
diventa asincrona, altrimenti si sbatte contro i timeout delle function.
