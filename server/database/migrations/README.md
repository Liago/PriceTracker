# Migrazioni

Lo schema del database e' versionato qui. I file vanno applicati con il runner,
non incollati a mano nella console Supabase.

```bash
cd server
export DATABASE_URL="postgresql://postgres:PASSWORD@db.PROGETTO.supabase.co:5432/postgres"
npm run migrate:status   # mostra cosa manca, senza modificare nulla
npm run migrate          # applica le migrazioni mancanti
```

`DATABASE_URL` e' la connection string Postgres del progetto Supabase
(Project Settings > Database > Connection string). La anon key e la service
role key non bastano: `supabase-js` non esegue DDL.

## Convenzioni

- Nome file: `NNN_nome_snake_case.sql`, numerazione progressiva senza buchi.
- **Ogni migrazione dev'essere idempotente**: `create ... if not exists`,
  `drop policy if exists` prima di `create policy`, `add column if not exists`.
  Il runner salta comunque le migrazioni gia' registrate, ma l'idempotenza
  serve per il primo passaggio su un database che esisteva gia'.
- **Riaffermare i vincoli separatamente.** `add column if not exists` non fa
  nulla se la colonna esiste gia', quindi un `not null` o un `default` scritti
  li' dentro non verrebbero applicati a un database esistente. Vanno ripetuti
  con `alter column ... set not null` dopo aver ripulito le righe.
- Usare `gen_random_uuid()`, non `uuid_generate_v4()`: la prima e' integrata in
  Postgres, la seconda richiede l'estensione `uuid-ossp`.
- Una migrazione gia' applicata non si modifica: se ne scrive una nuova. Il
  runner tiene un checksum e segnala i file cambiati dopo il fatto.

## Come funziona

Il runner crea `public.schema_migrations (version, name, checksum, applied_at)`
e vi registra ogni migrazione applicata. Ogni migrazione gira in una
transazione: se fallisce non lascia lo schema a meta'. Rieseguire il comando e'
sempre sicuro.

La logica di scoperta e ordinamento sta in `../migrationSet.js`, separata
dall'esecuzione per essere testabile senza database (`server/test/migrationSet.test.js`).

## Verifica

Le migrazioni sono state verificate su Postgres 16 in due scenari, che
producono uno schema identico:

1. database vuoto;
2. database che gia' conteneva lo schema legacy applicato a mano, comprese le
   colonne `products.store` e `products.details` aggiunte fuori da qualsiasi
   file, e una riga `user_settings` con il vecchio `price_check_interval = 6`.
