# Tracking reliability rollout

This change requires `server/database/migrations/012_tracking_reliability.sql`.
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

Alternatively, run the contents of migration 012 in the Supabase SQL editor, inside
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
seller's price or lowers the acceptance threshold. Zeiss B09K48BMV8 still needs a
capture from the failing production request: the development session currently
receives Amazon's unsupported-session page instead of that product's markup.
