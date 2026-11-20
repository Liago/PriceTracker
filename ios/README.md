# PriceTracker per iOS

App nativa in **SwiftUI** che usa lo stesso backend del client web: Supabase per
autenticazione e dati (con RLS) e il server Express/Netlify per tutto ciò che
richiede lo scraping.

## Requisiti

- Xcode 16 o successivo
- iOS 18 o successivo (su iOS 26 l'interfaccia adotta automaticamente Liquid Glass)
- Dipendenza Swift Package: [`supabase-swift`](https://github.com/supabase/supabase-swift), risolta da Xcode

## Configurazione

```bash
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig
```

Compila `Config/Secrets.xcconfig` (è in `.gitignore`):

| Chiave | Valore |
| --- | --- |
| `SUPABASE_URL` | URL del progetto, scritto `https:/$()/xxxx.supabase.co` |
| `SUPABASE_KEY` | chiave **pubblica** (publishable/anon), mai la service role |
| `API_BASE_URL` | indirizzo delle API, es. `https:/$()/tuo-sito.netlify.app/api` |
| `DEVELOPMENT_TEAM`, `APP_BUNDLE_ID` | facoltativi, per installare su un dispositivo |

Nelle `.xcconfig` `//` apre un commento: per questo negli URL si usa `$()`.
Senza configurazione l'app si avvia e mostra la schermata "Configurazione mancante".

Apri `PriceTracker.xcodeproj`, scegli lo schema **PriceTracker** e avvia (⌘R).
I test (Swift Testing) si lanciano con ⌘U.

## Funzionalità

- **Accesso e registrazione** con email e password, recupero password, AutoFill
  delle credenziali.
- **Prodotti**: riquadri di filtro rapido in stile Promemoria (tutti, a obiettivo,
  da verificare, non disponibili), ricerca, ordinamento, filtro per negozio,
  azioni a scorrimento, menu contestuale con anteprima, pull-to-refresh.
- **Aggiunta da link** con `PasteButton` (nessun avviso di accesso agli appunti),
  prezzo obiettivo e scadenza facoltativi. La lettura della pagina prosegue in
  background: il foglio si chiude subito e il prodotto compare come riga
  "in aggiunta" finché il server non ha finito.
- **Dettaglio prodotto**: immagine ingrandibile con transizione zoom, prezzo
  attuale e variazione, stato del tracking spiegato in italiano, grafico
  Swift Charts a gradini con selezione al tocco, intervalli 7G/1M/3M/1A/Tutto,
  minimo/medio/massimo, avviso di prezzo con suggerimenti (−5/−10/−20%),
  scheda prodotto (valutazione, venditore, variante, caratteristiche,
  specifiche), aggiornamento immediato, segnalazione di un prezzo errato,
  apertura del negozio in Safari, condivisione ed eliminazione.
- **Avvisi**: raggruppati per giorno, badge sul tab con i non letti, segna
  come letto/da leggere, elimina, filtro "solo da leggere".
- **Impostazioni**: frequenza dei controlli, email di avviso, pausa tra le
  richieste e tentativi, salvate automaticamente.
- **Link diretti**: `pricetracker://add?url=<link>`, `pricetracker://product/<id>`,
  `pricetracker://alerts`.
- Modalità scura, Dynamic Type, VoiceOver, iPad (larghezza di lettura) e
  feedback aptico.

## Struttura

```
PriceTracker/
├── App/               entry point, vista radice e tab
├── Core/
│   ├── Config/        valori da Info.plist
│   ├── Networking/    Supabase, API del server, decodifica JSON, errori
│   ├── Models/        Product, PricePoint, PriceAlert, UserSettings
│   └── Formatting/    prezzi, date, messaggi del motore, link
├── Stores/            stato osservabile (@Observable): sessione, prodotti, avvisi, impostazioni
├── DesignSystem/      card, miniature, badge, toast, Safari
├── Features/          Auth, Products, ProductDetail, AddProduct, Alerts, Settings
└── Preview/           dati di esempio per le anteprime
PriceTrackerTests/     test di decodifica, formattazione, grafico, filtri e link
```

Il progetto usa le cartelle sincronizzate di Xcode 16: i file aggiunti in
`PriceTracker/` entrano nel target senza modificare il progetto.

## Note sui dati

- I prezzi si mostrano come li salva il database ("nessun numero cambia"): niente
  arrotondamenti né separatori delle migliaia, come nel client web.
- `price_history` registra solo i cambi di prezzo, quindi il grafico è a gradini.
- Gli avvisi nascono sul database quando il prezzo scende fino all'obiettivo e il
  prodotto è disponibile; l'app li legge da `notifications`.

## CI

`.github/workflows/ios.yml` compila l'app, esegue i test su simulatore e
compila la build Release per dispositivo a ogni modifica sotto `ios/`.
