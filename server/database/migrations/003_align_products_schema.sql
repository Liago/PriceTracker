-- 003 - Porta nello schema versionato le colonne di products aggiunte a mano
-- direttamente in produzione.
--
-- Contesto (difetto D14 del design doc): il client scrive products.store e
-- products.details (client/src/components/Layout.jsx) e la dashboard filtra
-- per store, ma nessuna delle due colonne compare in schema.sql. Chi ricrea il
-- database da zero ottiene uno schema che l'applicazione non sa usare.
--
-- Nota sulla disponibilita': oggi non e' una colonna, vive dentro details come
-- details.available (client/src/pages/ProductDetail.jsx). Diventera' una
-- colonna di primo livello con enum normalizzato nella fase 4, insieme a
-- product_offers; qui ci limitiamo a registrare l'esistente.
--
-- Idempotente: puo' essere rieseguita senza effetti.

alter table public.products
  add column if not exists store   text,
  add column if not exists details jsonb;

-- I vincoli vanno riaffermati separatamente: dove la colonna esisteva gia'
-- (aggiunta a mano in produzione come jsonb nullable) "add column if not
-- exists" non fa nulla, e senza queste righe un database esistente resterebbe
-- diverso da uno ricreato da zero - esattamente il problema che le migrazioni
-- devono impedire.
update public.products set details = '{}'::jsonb where details is null;

alter table public.products
  alter column details set default '{}'::jsonb,
  alter column details set not null;

comment on column public.products.store is
  'Slug dello store di provenienza, valorizzato dallo scraper (es. amazon, mediaworld).';
comment on column public.products.details is
  'Dati accessori estratti dallo scraper: features, brand, taglie, available. La fase 4 ne promuove una parte a colonne.';

-- La dashboard filtra e raggruppa per store.
create index if not exists idx_products_store on public.products (store);
