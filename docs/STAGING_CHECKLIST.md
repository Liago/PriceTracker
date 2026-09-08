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
| `SCRAPE_REQUEST_BUDGET_MS` | opzionale, default 9000. Deve restare **sotto** il timeout delle function sincrone di Netlify (10s), altrimenti al posto della risposta arriva un 504 del proxy |
| `SCRAPE_TIER0` | opzionale, `on` per default. `off` disattiva la GET e torna a usare sempre il browser |
| `SCRAPE_TIER0_THRESHOLD` | opzionale, default 0.6. Sotto questa confidenza il tier 0 non basta e si sale al browser |
| `SCRAPE_TIER0_TIMEOUT_MS` | opzionale, default 6000 |
| `SCRAPE_BROWSER_MIN_MS` | opzionale, default 8000. Tempo residuo sotto il quale Chromium non viene nemmeno avviato |

> **Il vincolo che decide tutto.** Perché il browser possa partire serve
> `SCRAPE_REQUEST_BUDGET_MS >= SCRAPE_TIER0_TIMEOUT_MS + SCRAPE_BROWSER_MIN_MS`,
> cioè almeno **14 secondi**. Con i default (9000) non ci sta: sulle richieste
> sincrone esiste **solo il tier 0**, e ogni pagina che l'HTML statico non
> risolve risponde `503 SCRAPE_INCOMPLETE`. Non è un guasto, è aritmetica — e
> il motore lo dice da sé, con un avviso `[Scraper] ... il browser non parte
> mai` al primo caricamento. Se la piattaforma concede più di 10 secondi, alza
> il budget lasciando ~1s di margine per la risposta. Altrimenti quei controlli
> vanno lasciati al worker, che di budget ne ha 20.

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
   Cerca anche `[Scraper] Tier 0: confidenza`: su questi store la pagina va
   letta con una GET, senza avviare Chromium. Se vedi `Tier 0 sotto soglia`
   seguito dall'avvio del browser su uno store con dati strutturati, è il
   segnale che la pagina è cambiata.
2. **Aggiungi un prodotto da uno shop mai visto** — è il punto dell'intero
   refactor. Uno shop italiano su Shopify o WooCommerce è il caso migliore.
   Se il prezzo non è leggibile il prodotto **non viene creato**, con un
   messaggio esplicito: è voluto, non un errore.
3. **Se un'aggiunta fallisce, chiedi al motore perché.** Sia il 422 che il 503
   portano un blocco `diagnostics`: `tier` raggiunto, `htmlBytes` ricevuti,
   `pageTitle` letto e `extractors` con quanti candidati ha prodotto ciascuno
   (`jsonld:0 microdata:0 meta:3 …`). Sono dati sul nostro tentativo, e dicono
   in una riga se il problema è il sito, la pagina o la configurazione. Per
   indagare senza salvare nulla c'è `POST /api/scrape`, che restituisce lo
   stesso `debug` completo.
4. **Refresh manuale** su un prodotto esistente. Se il prezzo letto non è
   attendibile vedrai «Aggiornato, ma il prezzo letto non è attendibile»: il
   prezzo precedente resta, ed è il comportamento corretto.
5. **Segnala un prezzo sbagliato** con il pulsante nella pagina prodotto. Poi
   verifica che la ricetta sia andata in quarantena:
   ```sql
   select domain, status from scrape_recipes where status = 'quarantined';
   ```

## 4. Cosa guardare nei log

Tre prefissi stabili, tutti grep-abili dai log di Netlify:

- `[Metric]` — una riga JSON per controllo: dominio, esito, confidenza,
  sorgente, se ha usato il fast path, durata. È la misura che conta.
- `[Scraper] Tier 0` — la pagina è stata letta senza browser. La quota di
  controlli che si fermano qui è la misura del costo: ogni riga che manca è
  un avvio di Chromium.
- `[Scraper] Tier 0: pagina di sfida` — il sito ha risposto con una verifica
  di sicurezza (Cloudflare, DataDome, PerimeterX…) al posto della pagina. La
  riga riporta il fornitore, il titolo ricevuto e i byte.
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
| 504 con una pagina HTML («Inactivity Timeout») al posto di JSON | log Netlify, durata della function | la richiesta ha superato il timeout della piattaforma: `SCRAPE_REQUEST_BUDGET_MS` è troppo alto per il limite del tuo piano |
| 504 JSON con `code: SCRAPE_BUDGET_EXCEEDED` | il campo `reason` nella risposta | è il motore che si ferma per tempo, non il proxy che tronca. `budget_esaurito`: la pagina è lenta; `antiBotSuspected: true`: il sito rifiuta la lettura automatica |
| 503 `SCRAPE_INCOMPLETE` | il blocco `diagnostics` nella risposta | la pagina non è stata letta fino in fondo. `tier0Skipped: "sfida_*"`: il sito ha risposto con una verifica di sicurezza; `degraded: "budget_esaurito"`: il browser non è partito (vedi il vincolo in §1) |
| 422 `LOW_CONFIDENCE` con `diagnostics.htmlBytes` alto e `extractors` tutti a `:0` | `diagnostics.pageTitle` | la pagina è arrivata intera ma nessun estrattore ci ha trovato un prodotto: probabilmente non è una scheda prodotto, o è un listing |
| Molti `Tier 0 sotto soglia` su un dominio | `[Scraper]` nei log | la ricetta di quel dominio non regge sull'HTML statico: il prezzo arriva da JavaScript |

## 6. Come tornare indietro

Nessuna migrazione elimina dati. Se il motore nuovo si comporta peggio del
previsto:

- **Fermare i controlli automatici** senza toccare il codice: metti in pausa le
  funzioni schedulate `dispatcher` e `worker` dalla UI di Netlify.
- **Disattivare il fast path** e forzare sempre la scoperta completa:
  `SCRAPE_FAST_PATH_THRESHOLD=2` (nessuna confidenza raggiunge 2).
- **Disattivare il tier 0** e tornare al browser per ogni controllo:
  `SCRAPE_TIER0=off`. Da usare solo per i worker: sulle richieste sincrone
  il browser non ci sta nel budget di Netlify.
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

- ~~**Tier 0 HTTP** (difetto D12)~~ — fatto. Il motore prova prima una GET e
  avvia Chromium solo quando l'HTML statico non basta. Non era solo un
  risparmio: dentro il budget di dieci secondi di una function sincrona il
  browser non ci stava, e l'aggiunta di un prodotto finiva sistematicamente in
  504. Resta da **misurare** la quota reale di controlli che si fermano al
  tier 0, contando le righe `[Scraper] Tier 0: confidenza` sul totale.
- Rimuovere il dual write su `price_history` quando il client userà
  `price_history_v`.
- Valutare l'integrazione LLM per la generazione delle ricette (sezione 19 del
  design doc), che ha senso solo dopo aver misurato dove la scoperta fallisce
  davvero.
