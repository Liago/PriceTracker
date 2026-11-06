# Tracking reliability rollout

This change requires migrations `012_tracking_reliability.sql` and
`013_product_import_jobs.sql` in `server/database/migrations/`.
If 012 is already applied, only 013 is new.
The Netlify build checks `tracking_schema_version()` before publishing the new code.
Apply the migration before retrying a production build. The check prevents publishing
code that would call RPCs absent from the current database.

## Apply

With the existing Postgres connection configured privately as `DATABASE_URL`:

```sh
cd server
npm ci
npm run migrate:status
npm run migrate
```

Alternatively, run each new migration in order in the Supabase SQL editor, inside
one transaction (`BEGIN;` / `COMMIT;`). If using the SQL editor, register the migration
through the normal migration runner afterwards; the SQL is idempotent. Versions
000–011 must already be present. Do not modify old migration files or expose database
credentials in logs, commits or messages.

The migration adds transactional product creation/price checks, durable scrape audit
records, a shared domain reservation table, an email outbox and atomic recipe promotion.
Affected Amazon/Swappie products keep all previous values and history, but are marked
`degraded` until a trusted new reading succeeds. Existing wrong historical observations
are not automatically deleted: review them against a known product/variant first.

## Behavior

- Initial creation, manual refresh and scheduled jobs share the same validation.
- Amazon requires a unique non-struck price in the primary price container. Related
  products, list prices and a missing buy-box price do not become a tracked price.
- Swappie reads `selectedProduct`, preserving storage, color, grade, battery type and
  SKU, with explicit monetary precision. A model-wide OG price is insufficient.
- Recipes are compared with current sources on every reading. Reapplying one source
  is not independent corroboration. Conflicting comparable prices and ranges are rejected.
- A pinned identity/variant cannot silently switch. Enriching a legacy offer is allowed
  only while previously known identifiers and attributes remain consistent.
- SQL transactions lock the product and reject stale checks. Price, observation,
  history, notification and email event commit together or roll back together.
- A target-crossing alert requires an accepted, in-stock offer. The in-app notification
  is distinct from email delivery. Additional drops already below the target do not
  create more target-crossing alerts.
- Email delivery uses leases and recoverable retries, respects current preferences,
  and never simulates success if SMTP is missing. Configure `SMTP_USER`/`SMTP_PASS`
  (legacy `EMAIL_USER`/`EMAIL_PASS` are accepted), with optional host/port/from values.
  SMTP delivery is at least once: a process killed after SMTP accepts a message but
  before the sent marker is stored may retry it. A stable Message-ID aids diagnosis.
- Deferred jobs do not consume scrape attempts. Per-domain reservations coordinate
  workers and manual refreshes. Automatic jobs and local development share the queue.
- Product screens and notification counters refresh on database events, focus and a
  one-minute fallback interval when realtime publications are unavailable.

## Verify after migration/deploy

1. Create or refresh one Amazon and one Swappie product with a known selected configuration.
2. Compare the accepted observation and selected SKU/variant to the store. Check
   `last_success_at`, `tracking_health`, and `scrape_runs.validation` when a reading fails.
3. Check the dispatcher/worker schedules and `scrape_jobs` for progress; inspect
   deferred `run_after` and dead-job errors rather than interpreting them as price stability.
4. For a genuine target crossing, verify one notification and inspect
   `notification_outbox.status`, `last_error` and `sent_at` separately.
5. Review legacy prices marked for verification. A blocked or ambiguous page should
   retain the last good price and show a degraded/blocked state.

Automated validation: `cd server && npm test`; `cd client && npm run build && npm run lint`.
The database integration suite runs all migrations on an embedded PostgreSQL engine,
including rollback injection, concurrent stale checks, preference handling, outbox leases,
domain reservations and candidate promotion. No production database is needed for tests.

## Reading budget and failure diagnostics

Netlify currently documents 60 seconds for synchronous functions and 30 seconds for
scheduled functions. Defaults are 45 seconds per API scrape and 26 seconds per worker
batch (including a 4-second persistence reserve). If an older environment variable
`SCRAPE_REQUEST_BUDGET_MS=9000` is still configured, remove it to use the default, or
set it to `45000`. Similarly remove a legacy `SCRAPE_WORKER_BUDGET_MS=20000` override
when using the new worker default. Do not exceed the platform limit.

A rejected HTTP request followed by insufficient browser time is a budget failure,
not proof that a retailer cannot be read. The audit stores the actual failure reason,
HTTP status, attempted tier and elapsed time in `scrape_runs.result.diagnostics`.
The product page distinguishes timeout and changed configuration from a blocked request.
A model-wide URL can choose a different SKU/color over time; the pinned SKU must not
be replaced by that default. Use a stable configuration URL when available.

Amazon prices explicitly withheld until the cart are reported as `price_requires_cart`,
not a generic scraper error. Other-seller "from" prices are never substituted for
that offer. No item is added to a cart. Amazon tracking links are normalized to the
ASIN route while retaining explicit merchant/variant selection; short links retain
the validated final retailer URL after redirection.

Seeded recipes try HTTP before using a browser: legacy `transport=browser` seed data
does not prove that JavaScript is necessary. Manual browser preferences still apply.
For structured products, `productID` is retained as an identity fallback when `sku`
is absent; explicit storage/color become pinned offer attributes on a valid reading.

When Amazon has no accepted main price, `diagnostics.priceExtraction` in the
`POST /products` response distinguishes missing selectors, rejected nodes and
conflicting prices. It records selector counts, rejection filters and a bounded
inventory of price nodes in the primary price/buy-box containers. This evidence
also survives in scraper diagnostics for refreshes. It never substitutes another
seller's price or lowers the acceptance threshold.

For Amazon, browser readiness waits for a populated primary-price node or an
explicit unavailable/cart-only state, rather than accepting in-stock availability
as evidence that price widgets have loaded. The wait is bounded to 8 seconds and
the remaining request budget. No synthetic retailer session cookies are injected.
Legacy primary buy-box prices and the `corePrice_desktop_feature_div` layout are
also supported. A timed-out wait with no accepted primary price is reported as
`prezzo_non_caricato`, with `priceReadinessTimedOut` and `readinessBudgetMs` in
diagnostics; it is an incomplete reading, not an invalid product configuration.
The Zeiss B09K48BMV8 production failure had empty known price roots and no matching
price nodes. Tests reproduce delayed price loading, but live recovery for that
specific product must still be verified after deployment.

## Asynchronous product additions (schema 13)

Apply `013_product_import_jobs.sql` before deploying this version. The build
preflight requires schema 13; the previous deployment keeps serving until then.
No additional secret is needed: internal background invocations are signed using
the existing service key and target the deployment URL supplied by Netlify.

On the deployed API, `POST /products` now enqueues the addition and returns
`202 {jobId,status}` before starting Chromium. The browser checks
`GET /product-imports/:id` with the user's session; the endpoint only returns
that user's job. Success contains the product, while a failed job retains the
original validation reasons and extraction diagnostics. Explicit `async:false`
retains the synchronous API for compatibility, with its platform/proxy limits.

`product-import-background` performs the same URL policy, extraction and initial
price validation as the synchronous route. Claim leases prevent concurrent work;
product creation and the job result commit in one database transaction. Replaying
a completed import cannot create another product. Client request IDs survive lost
HTTP responses in session storage, so retrying the same addition resumes its job.
`import-dispatcher` recovers pending and stale jobs every two minutes. Local Express
starts the same processor outside the response; durable automatic recovery runs
on Netlify. No product or price history is created for a rejected first reading.

This removes the long silent connection responsible for intermediary inactivity
timeouts during addition. It does not guarantee that a retailer will supply a
verifiable price: those failures remain explicit results rather than HTML 504s.

## Correzioni: aggiunta Amazon e letture nel tempo

- **Prezzo Amazon con `.a-offscreen` vuoto.** Il markup attuale del prezzo da
  pagare lascia spesso vuoto `.a-offscreen` e scrive il prezzo nei nodi
  `a-price-whole`/`a-price-fraction`/`a-price-symbol`. L'estrattore leggeva
  solo il primo: ogni scheda risultava `main_price_unavailable` e l'aggiunta
  falliva. Ora il prezzo si ricompone dai nodi visibili, con gli stessi filtri
  (barrati, prezzo consigliato, abbonamento, rate). La readiness del browser
  usa lo stesso criterio, invece di attendere 8 secondi e chiudere con
  `prezzo_non_caricato`.
- **`psc=1` nella richiesta Amazon.** La canonicalizzazione lo toglie dall'URL
  salvato, ma per Amazon indica la variante selezionata: senza, la scheda di
  una variante puo' non mostrare il buy box. Si aggiunge solo all'URL scaricato.
- **Avvio delle background function.** `dispatchImport` non richiede piu'
  `NETLIFY=true`, garantita in build ma non a runtime: se mancava, nessuna
  aggiunta partiva e il client attendeva fino al proprio timeout. Il job di
  aggiunta ha un budget di 120 s (`SCRAPE_IMPORT_BUDGET_MS`), non i 45 s della
  richiesta sincrona.
- **Controlli programmati in background.** La function schedulata `worker`
  avvia `scrape-worker-background` (lotto `SCRAPE_BACKGROUND_BATCH`=15, budget
  `SCRAPE_BACKGROUND_BUDGET_MS`=300000, tetto per prodotto
  `SCRAPE_BACKGROUND_JOB_MS`=75000). Se l'avvio non riesce esegue il lotto da
  se' con i limiti di prima. Nei 30 secondi di una function schedulata un solo
  prodotto che richiede il browser consumava il lotto.
- **Conferma nel tempo.** Una variazione oltre il 60% con confidenza sotto
  0,90 richiede conferma; la seconda lettura nello stesso controllo rilegge la
  stessa fonte e non risultava quasi mai indipendente, mentre lo storico di
  riferimento contiene solo prezzi accettati. Il prodotto restava fermo sul
  vecchio prezzo per sempre. Ora lo stesso prezzo (stessa valuta, stessa
  offerta) gia' respinto solo per la variazione al controllo precedente vale
  come conferma.

Le background function richiedono un piano Netlify che le includa: verificare
nei log che `worker` risponda `202` e che `scrape-worker-background` compaia
fra le function invocate. Nessuna nuova migrazione.

## Amazon: link brevi e posizione di consegna

- I link brevi (`amzn.eu`, `amzn.to`, `a.co`) si risolvono prima della lettura,
  seguendo solo redirect verso Amazon: la scheda si scarica con `/dp/ASIN?psc=1`
  e il browser riconosce Amazon (prima l'attesa del prezzo scendeva a 2,5 s).
- Amazon sceglie la posizione di consegna dall'IP. Le function Netlify girano
  fuori dall'Italia e la scheda risulta «non spedibile», senza prezzo nel buy
  box: era la causa delle letture vuote (e, prima dell'estrattore dedicato, dei
  prezzi presi da prodotti correlati). Quando il prezzo non compare, il browser
  imposta il CAP dal selettore «Invia a» (20121 per amazon.it; override con
  `AMAZON_DELIVERY_ZIP`) e ricarica la scheda. Esito in
  `diagnostics.deliveryLocation` (`before`, `after`, `updated`, `error`).
- `diagnostics.priceExtraction.page` riporta posizione mostrata da Amazon,
  disponibilita', testo del buy box, contenitori presenti e prezzi con il loro
  contenitore: dice perche' il prezzo manca senza dover catturare la pagina.
