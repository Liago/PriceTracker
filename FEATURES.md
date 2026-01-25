# FEATURES.md - Miglioramenti e Nuove Funzionalità

Documento che descrive tutti i miglioramenti necessari e possibili per **PriceTracker**, organizzati per priorità e importanza.

**Stato attuale del progetto**: Applicazione web funzionante con tracciamento prezzi per Amazon, Swappie e Refurbed. Sistema di notifiche email implementato, sicurezza base configurata.

---

## Legenda Priorità

| Simbolo | Priorità | Descrizione |
|---------|----------|-------------|
| 🔴 | **CRITICA** | Bloccante o essenziale per la stabilità del prodotto |
| 🟠 | **ALTA** | Importante per la qualità e competitività del prodotto |
| 🟡 | **MEDIA** | Migliora significativamente l'esperienza utente |
| 🟢 | **BASSA** | Nice-to-have, migliorie future |

---

## 1. Miglioramenti Critici 🔴

### 1.1 Sistema di Testing Automatizzato
**Stato**: Non implementato
**Impatto**: Qualità, Stabilità, Manutenibilità

Il progetto attualmente ha **zero test coverage**. Questo rappresenta un rischio significativo per:
- Regressioni non rilevate durante lo sviluppo
- Difficoltà nel refactoring sicuro
- Mancanza di documentazione vivente del comportamento atteso

**Implementazione richiesta**:
- Unit test con Vitest per utilities (`parsePrice`, validatori)
- Test componenti React con React Testing Library
- Test API endpoints con Supertest
- Test E2E con Playwright per i flussi utente principali
- Coverage target: >70%

**File interessati**:
- `client/src/__tests__/` (da creare)
- `server/__tests__/` (da creare)
- `vitest.config.js` (da configurare)

---

### 1.2 CI/CD Pipeline
**Stato**: Non implementato
**Impatto**: Qualità, Deployment, Team Collaboration

Attualmente il deployment è manuale senza verifiche automatiche.

**Implementazione richiesta**:
- GitHub Actions workflow per:
  - Lint automatico su ogni PR
  - Esecuzione test suite
  - Build verification
  - Deploy automatico su staging (PR) e production (merge)
- Pre-commit hooks con Husky per lint locale
- Conventional commits enforcement

**File interessati**:
- `.github/workflows/ci.yml` (da creare)
- `.github/workflows/deploy.yml` (da creare)
- `.husky/` (da creare)

---

### 1.3 Monitoring e Error Tracking
**Stato**: Non implementato
**Impatto**: Affidabilità, Debugging, User Experience

Nessun sistema per tracciare errori in produzione o performance.

**Implementazione richiesta**:
- Integrazione Sentry per error tracking
- Logging strutturato con aggregazione (Logtail/Papertrail)
- Uptime monitoring (UptimeRobot o simili)
- Web Vitals tracking per performance frontend
- Alert automatici su:
  - Scraper failure rate >50%
  - Errori API sopra soglia
  - Scheduled function failures

---

### 1.4 Error Boundaries React
**Stato**: Non implementato
**Impatto**: User Experience, Stabilità

Errori JavaScript non gestiti causano crash dell'intera applicazione.

**Implementazione richiesta**:
- Componente `ErrorBoundary` globale
- Fallback UI per componenti falliti
- Logging errori client-side
- Pulsante "Riprova" per recupero graceful

**File da creare**:
- `client/src/components/ErrorBoundary.jsx`

---

## 2. Miglioramenti Alta Priorità 🟠

### 2.1 UI per Sistema Notifiche
**Stato**: Backend pronto, UI mancante
**Impatto**: User Experience, Engagement

La tabella `notifications` esiste nel database ma non c'è modo per l'utente di visualizzarle.

**Implementazione richiesta**:
- Componente `NotificationBell` nell'header con badge contatore
- Dropdown per notifiche recenti
- Pagina dedicata `/notifications` per lo storico completo
- Funzionalità:
  - Segna come letto/non letto
  - Elimina notifiche singole o multiple
  - Filtri per tipo (price_drop, price_increase)
  - Ordinamento per data

**File da creare**:
- `client/src/components/NotificationBell.jsx`
- `client/src/pages/Notifications.jsx`

---

### 2.2 Supporto Nuovi Store
**Stato**: Solo Amazon, Swappie, Refurbed
**Impatto**: Utilità, Competitività

Espandere il supporto a più e-commerce popolari.

**Store da implementare** (in ordine di priorità):
1. **eBay** - Marketplace globale
2. **MediaWorld** - Elettronica Italia
3. **Unieuro** - Elettronica Italia
4. **Zalando** - Moda
5. **AliExpress** - Prezzi bassi, spedizioni lunghe
6. **ePrice** - Elettronica Italia

**Implementazione richiesta**:
- Nuove classi scraper per ogni store (Strategy Pattern già in uso)
- Selectors specifici per ogni sito
- Gestione peculiarità (varianti, prezzi dinamici)
- Test specifici per ogni scraper

**File interessati**:
- `server/services/scrapers/` (nuovi file)
- `server/services/scraper.js` (factory update)

---

### 2.3 Gestione CAPTCHA
**Stato**: Non implementato
**Impatto**: Affidabilità Scraping

Lo scraper fallisce quando incontra pagine CAPTCHA.

**Implementazione richiesta**:
- Integrazione servizio solving (2Captcha, Anti-Captcha)
- Rotazione User-Agent più sofisticata
- Proxy rotation per IP diversi
- Browser fingerprint randomization
- Retry intelligente con backoff esponenziale

**File interessati**:
- `server/services/scraper.js`
- `server/services/scrapers/BaseScraper.js`

---

### 2.4 Paginazione Dashboard
**Stato**: Non implementato
**Impatto**: Performance, Scalabilità

Tutti i prodotti vengono caricati in memoria simultaneamente.

**Implementazione richiesta**:
- Paginazione lato server con Supabase range queries
- Opzioni UI:
  - Infinite scroll (preferibile per mobile)
  - Paginazione classica (preferibile per desktop)
- Configurazione elementi per pagina (10/25/50)
- Mantenimento filtri e ordinamento durante navigazione

**File interessati**:
- `client/src/pages/Dashboard.jsx`
- API endpoints per query paginate

---

### 2.5 Database Migrations System
**Stato**: SQL manuale
**Impatto**: Manutenibilità, Team Collaboration

Le modifiche al database sono eseguite manualmente senza versionamento.

**Implementazione richiesta**:
- Sistema migration (Supabase CLI migrations o dbmate)
- Version control per ogni schema change
- Rollback capability
- Seed data per development environment
- Documentazione processo di migrazione

**File interessati**:
- `server/database/migrations/` (struttura da organizzare)

---

### 2.6 Documentazione README Completa
**Stato**: Incompleto
**Impatto**: Onboarding, Contribution

README attuale manca di informazioni essenziali per setup.

**Sezioni da aggiungere**:
- Prerequisites dettagliati (Node, npm, account Supabase)
- Guida setup passo-passo completa
- Configurazione database con tutti gli script SQL
- Environment variables con descrizioni
- Troubleshooting problemi comuni
- Screenshots/GIF dell'applicazione
- Architettura ad alto livello

---

## 3. Miglioramenti Media Priorità 🟡

### 3.1 Sistema di Caching
**Stato**: Non implementato
**Impatto**: Performance, Costi

Ogni richiesta colpisce direttamente il database.

**Implementazione richiesta**:
- Redis cache (Upstash per serverless)
- Cache prodotti utente (TTL 5 minuti)
- Cache risultati scraping (TTL 1 ora)
- Cache immagini prodotti su CDN (Cloudinary/Cloudflare)
- Invalidazione cache su update

---

### 3.2 Notifiche Avanzate
**Stato**: Solo notifica prezzo sotto target
**Impatto**: User Value

Estendere i tipi di notifiche disponibili.

**Nuove notifiche**:
- Variazione prezzo significativa (>10%)
- Prodotto tornato disponibile
- Prezzo ai minimi storici
- Digest giornaliero/settimanale riepilogativo
- Monitoraggio in scadenza (reminder)

**Preferenze utente**:
- Attiva/disattiva per tipo
- Frequenza digest personalizzabile
- Canale preferito (email, push, in-app)

---

### 3.3 Categorie e Tag Prodotti
**Stato**: Non implementato
**Impatto**: Organizzazione, UX

Nessun modo di organizzare i prodotti tracciati.

**Implementazione richiesta**:
- Categorie predefinite (Elettronica, Abbigliamento, Casa, etc.)
- Tag personalizzabili dall'utente
- Filtro dashboard per categoria/tag
- Assegnazione multipla per prodotto
- Gestione tag in settings

**Database**:
- Tabella `categories` (predefinite)
- Tabella `product_tags` (join table)

---

### 3.4 Loading States e Skeleton UI
**Stato**: Parziale
**Impatto**: Perceived Performance, UX

Feedback visivo durante caricamenti inconsistente.

**Implementazione richiesta**:
- Skeleton loaders per dashboard grid/list
- Loading spinners consistenti
- Optimistic updates con React Query
- Suspense boundaries per lazy components
- Smooth transitions tra stati

---

### 3.5 Ottimizzazione Mobile
**Stato**: Responsive base
**Impatto**: Mobile Users, Accessibility

Esperienza mobile migliorabile.

**Implementazione richiesta**:
- Bottom navigation per mobile
- Touch gestures (swipe to delete)
- Ottimizzazione font sizes e touch targets
- Viewport e layout migliorati
- Lazy loading immagini migliorato

---

### 3.6 Supporto Multi-Valuta
**Stato**: Solo EUR
**Impatto**: Internazionalizzazione

Prodotti da store internazionali usano valute diverse.

**Implementazione richiesta**:
- Rilevamento automatico valuta dal sito
- API conversione tassi (exchangerate-api)
- Valuta preferita utente in settings
- Normalizzazione prezzi per confronti
- Display valuta originale + convertita

---

### 3.7 Export/Import Dati
**Stato**: Non implementato
**Impatto**: User Value, GDPR

Nessuna portabilità dei dati utente.

**Implementazione richiesta**:
- Export prodotti (CSV, JSON)
- Export storico prezzi
- Import bulk da file
- Backup automatico periodico
- GDPR data portability compliance

---

### 3.8 TypeScript Migration
**Stato**: JavaScript puro
**Impatto**: Developer Experience, Manutenibilità

Progetto interamente in JavaScript senza type safety.

**Implementazione richiesta**:
- Migrazione graduale partendo da utilities
- Strict mode TypeScript
- Shared types tra client/server
- Path: utilities → services → components → pages

---

### 3.9 Content Security Policy (CSP)
**Stato**: Non configurato
**Impatto**: Sicurezza

Mancano header di sicurezza CSP.

**Implementazione richiesta**:
- Configurazione CSP headers su Netlify
- Whitelist fonti script autorizzate
- Whitelist fonti immagini (CDN store)
- Report-only mode iniziale per test

---

### 3.10 Component Refactoring
**Stato**: Componenti grandi
**Impatto**: Manutenibilità, Testabilità

`ProductDetail.jsx` (421 righe) e `Dashboard.jsx` (315 righe) sono troppo grandi.

**Scomposizione ProductDetail**:
- `ProductHeader.jsx` - Titolo, store, link
- `ProductImage.jsx` - Immagine con fallback
- `PriceChart.jsx` - Grafico storico prezzi
- `ProductSettings.jsx` - Target price, monitoring date
- `ProductActions.jsx` - Pulsanti azione

**Custom hooks da estrarre**:
- `useProductData` - Fetching e caching dati
- `usePriceHistory` - Gestione storico prezzi
- `useProductActions` - Azioni CRUD

---

## 4. Miglioramenti Bassa Priorità 🟢

### 4.1 PWA Support
**Impatto**: Engagement, Offline Usage

Rendere l'app installabile e usabile offline.

**Implementazione**:
- Service worker per caching assets
- App manifest per installazione
- Push notifications browser
- Background sync per azioni offline
- Offline-first per visualizzazione prodotti

---

### 4.2 Dark/Light Mode Toggle
**Impatto**: UX, Accessibility

Attualmente solo dark mode disponibile.

**Implementazione**:
- Toggle in settings/header
- Persistenza preferenza (localStorage + DB)
- Rispetto preferenza sistema operativo
- Smooth transition tra temi
- DaisyUI theme switching

---

### 4.3 Dashboard Analytics
**Impatto**: User Insights

Statistiche aggregate sui prodotti tracciati.

**Metriche da mostrare**:
- Risparmio totale potenziale
- Miglior affare della settimana
- Trend prezzi generale (su/giù)
- Store più conveniente
- Prodotti con maggior calo percentuale

**Visualizzazioni**:
- Chart riepilogativi
- Tabelle comparative
- Export report PDF

---

### 4.4 Confronto Prezzi Multi-Store
**Impatto**: User Value

Trovare lo stesso prodotto su più store.

**Implementazione**:
- Ricerca automatica prodotto simile
- Tabella comparativa prezzi
- Badge "Miglior prezzo"
- Notifica se altro store più conveniente
- Matching basato su nome/EAN/ASIN

---

### 4.5 Price Prediction
**Impatto**: User Value (Avanzato)

Suggerire il momento migliore per acquistare.

**Implementazione**:
- Algoritmo ML su storico prezzi
- Pattern stagionali (Black Friday, Prime Day)
- Indicatore "Consigliato comprare ora"
- Previsione trend prossime settimane

---

### 4.6 Wishlist Condivise
**Impatto**: Social, Engagement

Condividere liste prodotti con altri.

**Implementazione**:
- Creazione liste nominative
- Link pubblici/privati condivisibili
- Collaborazione multi-utente
- Permission system (view/edit)
- Notifiche su modifiche lista

---

### 4.7 Estensione Browser
**Impatto**: Convenience, Engagement

Aggiungere prodotti direttamente dal sito.

**Implementazione**:
- Estensione Chrome/Firefox
- Pulsante "Aggiungi a PriceTracker"
- Popup con prezzo attuale e storico
- Notifiche desktop
- Comparazione inline su pagina prodotto

---

### 4.8 Design System / Storybook
**Impatto**: Developer Experience, Consistency

Componenti UI non documentati.

**Implementazione**:
- Storybook per component showcase
- Design tokens (colori, spacing, typography)
- Componenti atomici riutilizzabili
- Documentazione props e varianti
- Visual testing integrato

---

### 4.9 Onboarding e Tutorial
**Impatto**: User Retention

Nessuna guida per nuovi utenti.

**Implementazione**:
- Tour guidato primo accesso (react-joyride)
- Empty states illustrati con CTA
- Tooltips su funzionalità avanzate
- Video tutorial (opzionale)

---

### 4.10 API Documentation
**Impatto**: Developer Experience

API non documentate.

**Implementazione**:
- OpenAPI/Swagger specification
- Documentazione endpoint
- Esempi request/response
- Playground interattivo
- Authentication flow documentation

---

## 5. Refactoring Tecnico Necessario

### 5.1 Utilities Duplicate
**Problema**: `parsePrice` duplicato tra client e server

**Soluzione**:
- Package condiviso `@pricetracker/utils`
- Import singolo invece di duplicazione
- Workspace npm/pnpm per gestione

---

### 5.2 Error Handling Standardizzato
**Problema**: Gestione errori inconsistente

**Soluzione**:
- Custom Error classes (es. `ScrapingError`, `ValidationError`)
- Error codes standardizzati
- Formato response errori API consistente
- Middleware centralizzato logging errori

---

### 5.3 Environment Validation
**Problema**: Nessuna validazione variabili ambiente

**Soluzione**:
- Libreria validation (envalid, zod)
- Fail-fast all'avvio se mancanti
- Type-safe access a env variables
- Documentazione automatica da schema

---

## 6. Riepilogo per Priorità

### Da Implementare Subito 🔴
1. Testing automatizzato (unit, integration, E2E)
2. CI/CD Pipeline con GitHub Actions
3. Monitoring e Error Tracking (Sentry)
4. Error Boundaries React

### Da Pianificare a Breve 🟠
5. UI Sistema Notifiche
6. Supporto nuovi store (eBay, MediaWorld)
7. Gestione CAPTCHA
8. Paginazione Dashboard
9. Database Migrations System
10. README completo

### Da Inserire in Roadmap 🟡
11. Sistema di Caching (Redis)
12. Notifiche avanzate
13. Categorie e Tag
14. Ottimizzazione Mobile
15. Multi-valuta
16. TypeScript Migration
17. Component Refactoring

### Future Enhancements 🟢
18. PWA Support
19. Dark/Light Mode
20. Analytics Dashboard
21. Confronto Multi-Store
22. Price Prediction
23. Wishlist Condivise
24. Estensione Browser

---

## Note Implementative

### Dipendenze tra Feature
- **UI Notifiche** richiede backend notifiche (già completato)
- **Paginazione** richiede prima ottimizzazione query DB
- **Multi-store** richiede prima gestione CAPTCHA per affidabilità
- **Export/Import** richiede prima categorie/tag per struttura completa
- **PWA** richiede prima Error Boundaries per stabilità

### Stima Effort (T-Shirt Sizing)
| Size | Descrizione | Esempi |
|------|-------------|--------|
| XS | Poche ore | Dark mode, Skeleton UI |
| S | 1-2 giorni | Error Boundaries, CSP |
| M | 3-5 giorni | UI Notifiche, Paginazione |
| L | 1-2 settimane | Nuovo store, Testing infra |
| XL | 2-4 settimane | TypeScript migration, PWA |

---

**Documento creato**: 2026-01-25
**Versione**: 1.0
**Basato su analisi codebase**: commit 63caad1

*Per contribuire o discutere queste feature, aprire una issue o PR sul repository.*
