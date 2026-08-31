# Verifica su Netlify — cosa controllare e in che ordine

Il refactor è verificato su 521 test e su Postgres 16 in locale, ma un'intera
classe di comportamenti non è esercitabile in sviluppo: rete, browser reale,
anti-bot, budget di tempo delle function. Questa è la lista di cosa provare, in
ordine, e di cosa guardare.

## 1. Prima del deploy

**Variabili d'ambiente** (Site settings → Environment variables):

| Variabile | Note |
|---|---|
| `SUPABASE_URL` | già presente |
| `SUPABASE_SERVICE_ROLE_KEY` | **necessaria**: worker e dispatcher scrivono con questa |
| `CLIENT_URL` | già presente |
| `SCRAPE_WORKER_BATCH` | opzionale, default 5 |
| `SCRAPE_WORKER_BUDGET_MS` | opzionale, default 20000 |
| `SCRAPE_FAST_PATH_THRESHOLD` | opzionale, default 0.85 |
| `SCRAPE_RESPECT_ROBOTS` | opzionale, default attivo |

**Migrazioni.** Vanno applicate *prima* del deploy del codice: il codice nuovo
usa tabelle che le migrazioni creano.

```bash
cd server
export DATABASE_URL="postgresql://postgres:PASSWORD@db.PROGETTO.supabase.co:5432/postgres"
npm run migrate:status   # a sola lettura, mostra cosa manca
npm run migrate
```

Le 11 migrazioni sono idempotenti e verificate su un database che già conteneva
lo schema legacy. Il backfill crea un'offerta `default` per ogni prodotto
esistente e migra lo storico in osservazioni.

## 2. Primo controllo dopo il deploy

```sql
-- Le ricette seminate ci sono?
select domain, status, origin from scrape_recipes order by domain;
-- Ogni prodotto ha la sua offerta?
select count(*) from products p left join product_offers o on o.product_id = p.id where o.id is null;
-- Lo storico è stato migrato?
select count(*) from price_observations;
```

## 3. Percorso utente, a mano

1. **Aggiungi un prodotto da uno store già supportato** (MediaWorld, BackMarket).
   Deve funzionare come prima. Nei log cerca `usedFastPath: true`: significa che
   la ricetta seminata ha funzionato e la scoperta completa è stata saltata.
2. **Aggiungi un prodotto da uno shop mai visto** — è il punto dell'intero
   refactor. Uno shop italiano su Shopify o WooCommerce è il caso migliore.
   Se il prezzo non è leggibile il prodotto **non viene creato**, con un
   messaggio esplicito: è voluto, non un errore.
3. **Refresh manuale** su un prodotto esistente. Se il prezzo letto non è
   attendibile vedrai «Aggiornato, ma il prezzo letto non è attendibile»: il
   prezzo precedente resta, ed è il comportamento corretto.
4. **Segnala un prezzo sbagliato** con il pulsante nella pagina prodotto. Poi
   verifica che la ricetta sia andata in quarantena:
   ```sql
   select domain, status from scrape_recipes where status = 'quarantined';
   ```

## 4. Cosa guardare nei log

Tre prefissi stabili, tutti grep-abili dai log di Netlify:

- `[Metric]` — una riga JSON per controllo: dominio, esito, confidenza,
  sorgente, se ha usato il fast path, durata. È la misura che conta.
- `[Dispatcher]` — quanti job accodati, quanti non dovuti, quanti in attesa.
- `[Worker …]` — quanti job elaborati e quanti restano.

**La domanda a cui rispondere nelle prime 24 ore:** qual è il tasso di
accettazione per dominio? Si ricava contando le righe `[Metric]` con
`"accepted":true` su quelle totali, per `domain`.

## 5. Segnali che qualcosa non va

| Sintomo | Dove guardare | Probabile causa |
|---|---|---|
| Molti prodotti in `tracking_health = 'broken'` | `select domain, count(*) from products where tracking_health='broken' group by domain` | anti-bot, oppure ricetta seminata sbagliata per quel dominio |
| Ricette che vanno in quarantena subito | `scrape_recipes` con `status='quarantined'` | i selettori trascritti a mano non corrispondono alle pagine reali |
| Osservazioni respinte in massa | `select reject_reason, count(*) from price_observations where not accepted group by 1` | la soglia di confidenza è troppo alta per il traffico reale |
| Coda che cresce senza scendere | `select status, count(*) from scrape_jobs group by 1` | i worker superano il budget: abbassa `SCRAPE_WORKER_BATCH` |
| Worker che non partono | log Netlify | manca `SUPABASE_SERVICE_ROLE_KEY` |

## 6. Come tornare indietro

Nessuna migrazione elimina dati. Se il motore nuovo si comporta peggio del
previsto:

- **Fermare i controlli automatici** senza toccare il codice: metti in pausa le
  funzioni schedulate `dispatcher` e `worker` dalla UI di Netlify.
- **Disattivare il fast path** e forzare sempre la scoperta completa:
  `SCRAPE_FAST_PATH_THRESHOLD=2` (nessuna confidenza raggiunge 2).
- **Sospendere una ricetta sbagliata** senza deploy:
  ```sql
  update scrape_recipes set status = 'deprecated' where domain = 'shop-problematico.it';
  ```
  Il motore torna alla scoperta completa per quel dominio.
- **Bloccare un dominio**:
  ```sql
  update domain_profiles set block_reason = 'sospeso a mano' where domain = 'shop.it';
  ```

Il rollback del codice è un normale rollback di deploy: lo schema nuovo è
compatibile all'indietro, perché `price_history` continua a essere scritta in
parallelo alle osservazioni.

## 7. Cosa resta da fare dopo

- **Tier 0 HTTP** (difetto D12): oggi ogni controllo avvia Chromium. Il motore
  lavora già sull'HTML e non sul `page` di Puppeteer, quindi scaricare la
  pagina senza browser è abilitato dall'architettura ma non implementato. È il
  prossimo guadagno di costo, stimato sul 70% dei controlli.
- Rimuovere il dual write su `price_history` quando il client userà
  `price_history_v`.
- Valutare l'integrazione LLM per la generazione delle ricette (sezione 19 del
  design doc), che ha senso solo dopo aver misurato dove la scoperta fallisce
  davvero.
