# IMPLEMENTATIONS.md

Documento di pianificazione per implementazioni, migliorie e nuove features del progetto **PriceTracker**.

---

## 📋 Indice

1. [Problemi Critici da Risolvere](#1-problemi-critici-da-risolvere)
2. [Feature Mancanti (Core)](#2-feature-mancanti-core)
3. [Miglioramenti di Sicurezza](#3-miglioramenti-di-sicurezza)
4. [Miglioramenti di Performance](#4-miglioramenti-di-performance)
5. [Miglioramenti UX/UI](#5-miglioramenti-uxui)
6. [Nuove Feature (Enhancement)](#6-nuove-feature-enhancement)
7. [Testing & Quality Assurance](#7-testing--quality-assurance)
8. [DevOps & Deployment](#8-devops--deployment)
9. [Documentazione](#9-documentazione)
10. [Refactoring Tecnico](#10-refactoring-tecnico)

---

## 1. Problemi Critici da Risolvere

### 🔴 PRIORITÀ MASSIMA

#### 1.1 Sicurezza File Ambiente
- **Problema**: File `.env` potenzialmente tracciato in git
- **Soluzione**:
  - [x] Aggiungere `.env` e `.env.*` a `.gitignore`
  - [x] Creare `.env.example` con variabili template
  - [x] Rimuovere eventuali `.env` dalla storia di git (git filter-branch)
  - [x] Aggiungere validazione environment variables all'avvio
- **Priorità**: COMPLETATO ✅

#### 1.2 Database: Policy Mancanti
- **Problema**: Policy INSERT per `price_history` potrebbe essere mancante
- **Soluzione**:
  - [x] Verificare ed applicare tutte le policy SQL in `/home/user/PriceTracker/server/database/policies.sql`
  - [x] Creare script di verifica delle policy
  - [x] Testare tutte le operazioni RLS
- **Priorità**: COMPLETATO ✅

#### 1.3 Cron Netlify Troppo Frequente
- **Problema**: Scheduled function configurata per eseguire ogni minuto (`* * * * *`)
- **Impatto**: Costi elevati, spreco risorse
- **Soluzione**:
  - [x] Modificare a esecuzione oraria o ogni 6 ore
  - [ ] Implementare logica intelligente basata su user settings
  - [ ] Aggiungere batch processing per multiple prodotti
- **Priorità**: COMPLETATO ✅
- **File**: `/home/user/PriceTracker/netlify/functions/scheduled-check.js`

#### 1.4 CORS Troppo Permissivo
- **Problema**: CORS configurato per permettere tutti gli origin
- **Soluzione**:
  - [x] Limitare CORS solo ai domini autorizzati
  - [x] Configurare whitelist basata su environment
- **Priorità**: COMPLETATO ✅
- **File**: `/home/user/PriceTracker/server/index.js`

---

## 2. Feature Mancanti (Core)

### 🟡 Funzionalità Base Non Implementate

#### 2.1 Sistema di Notifiche Email
- **Stato**: Schema database presente ma non implementato
- **Implementazione**:
  - [x] Integrare servizio email (Nodemailer)
  - [x] Creare template HTML per notifiche
  - [x] Implementare logica di invio quando:
    - [x] Prezzo scende sotto target
    - [ ] Prezzo cambia significativamente (es. >10%)
    - [ ] Prodotto torna disponibile
  - [ ] Aggiungere preferenze di notifica (frequenza, tipi)
  - [ ] Implementare digest giornaliero/settimanale
- **Priorità**: COMPLETATO ✅
- **File da modificare**:
  - `/home/user/PriceTracker/server/services/priceTracker.js`
  - Nuovo file: `/home/user/PriceTracker/server/services/emailService.js`

#### 2.2 UI per Notifiche
- **Stato**: Tabella `notifications` esiste ma nessuna UI
- **Implementazione**:
  - Componente NotificationBell con badge per notifiche non lette
  - Dropdown/modal per visualizzare notifiche recenti
  - Pagina dedicata per storico notifiche
  - Segna come letto/non letto
  - Cancellazione notifiche
  - Filtri per tipo di notifica
- **Priorità**: MEDIA 🟡
- **File da creare**:
  - `/home/user/PriceTracker/client/src/components/NotificationBell.jsx`
  - `/home/user/PriceTracker/client/src/pages/Notifications.jsx`

#### 2.3 Input Validation & Sanitization
- **Problema**: Nessuna validazione degli input utente
- **Rischi**: XSS, SQL injection (mitigato da Supabase), URL injection nel scraper
- **Implementazione**:
  - [x] Validare URL prodotti (whitelist domini supportati)
  - [x] Sanitizzare input utente prima del salvataggio
  - [ ] Validare parametri numerici (intervalli, prezzi)
  - [ ] Aggiungere Zod o Yup per schema validation
- **Priorità**: COMPLETATO ✅
- **File da modificare**:
  - Tutti gli endpoint API
  - `/home/user/PriceTracker/netlify/functions/api.js`

#### 2.4 Paginazione Dashboard
- **Problema**: Tutti i prodotti caricati in una volta
- **Impatto**: Performance scadenti con molti prodotti
- **Implementazione**:
  - Paginazione lato server (Supabase range query)
  - Infinite scroll o paginazione classica
  - Configurabile numero elementi per pagina
- **Priorità**: MEDIA 🟡
- **File**: `/home/user/PriceTracker/client/src/pages/Dashboard.jsx`

---

## 3. Miglioramenti di Sicurezza

#### 3.1 Rate Limiting
- **Implementazione**:
  - [x] Rate limiting su API endpoints (express-rate-limit)
  - [x] Protezione contro abuse dello scraper
  - [ ] Limitare numero di prodotti per utente
  - [ ] Limitare numero di refresh manuali
- **Priorità**: COMPLETATO ✅

#### 3.2 Gestione Service Role Key
- **Problema**: Service role key potrebbe essere esposta
- **Soluzione**:
  - [x] Verificare che sia solo in variabili ambiente
  - [x] Usare solo in contesti serverless
  - [x] Mai esporre al client
  - [x] Rotazione periodica delle chiavi
- **Priorità**: COMPLETATO ✅

#### 3.3 Protezione contro URL Injection
- **Implementazione**:
  - [x] Whitelist di domini supportati
  - [x] Validazione formato URL
  - [x] Sandbox per esecuzione scraper
  - [x] Timeout su richieste HTTP
- **Priorità**: COMPLETATO ✅
- **File**: `/home/user/PriceTracker/server/services/scraper.js`

#### 3.4 Content Security Policy (CSP)
- **Implementazione**:
  - Configurare CSP headers
  - Limitare fonti script e immagini
  - Protezione XSS
- **Priorità**: MEDIA 🟡

---

## 4. Miglioramenti di Performance

#### 4.1 Database Indexing
- **Problema**: Mancano indici su colonne frequentemente interrogate
- **Implementazione**:
  ```sql
  ```sql
  CREATE INDEX idx_products_user_id ON products(user_id);
  CREATE INDEX idx_price_history_product_id ON price_history(product_id);
  CREATE INDEX idx_price_history_recorded_at ON price_history(recorded_at DESC);
  CREATE INDEX idx_notifications_user_id_read ON notifications(user_id, read);
  ```
- **Priorità**: COMPLETATO ✅
- **File**: Nuovo file `/home/user/PriceTracker/server/database/indexes.sql`

#### 4.2 Caching Layer
- **Implementazione**:
  - Cache Redis per dati prodotti (Upstash Redis)
  - Cache immagini su CDN (Cloudinary, Cloudflare)
  - Cache query Supabase frequenti
  - Cache scraping risultati (TTL breve)
- **Priorità**: MEDIA 🟡

#### 4.3 Image Optimization
- **Implementazione**:
  - Lazy loading immagini dashboard
  - Responsive images (srcset)
  - Compressione immagini
  - Placeholder blur durante caricamento
  - CDN per static assets
- **Priorità**: MEDIA 🟡

#### 4.4 Code Splitting & Bundle Optimization
- **Implementazione**:
  - Route-based code splitting (già parzialmente implementato con React Router)
  - Lazy loading componenti pesanti (Recharts)
  - Analisi bundle size (vite-bundle-visualizer)
  - Tree shaking ottimizzato
- **Priorità**: BASSA 🟢

#### 4.5 Scraper Performance
- **Problema**: Scraping sincrono, blocca altre operazioni
- **Implementazione**:
  - Queue system (BullMQ, AWS SQS, Supabase Queue)
  - Parallel scraping con worker pool
  - Priorità dinamica (prodotti con target price first)
  - Backoff esponenziale su errori
- **Priorità**: MEDIA 🟡
- **File**: `/home/user/PriceTracker/server/services/scraper.js`

---

## 5. Miglioramenti UX/UI

#### 5.1 Loading States
- **Implementazione**:
  - Skeleton loaders per dashboard
  - Loading spinners consistenti
  - Optimistic updates (React Query)
  - Suspense boundaries
- **Priorità**: MEDIA 🟡

#### 5.2 Error Boundaries & Error Handling
- **Implementazione**:
  - Error Boundary component React
  - Gestione errori API user-friendly
  - Retry automatico con feedback visivo
  - Fallback UI per componenti falliti
- **Priorità**: MEDIA 🟡
- **File da creare**: `/home/user/PriceTracker/client/src/components/ErrorBoundary.jsx`

#### 5.3 Dark/Light Mode Toggle
- **Stato**: Solo dark mode disponibile
- **Implementazione**:
  - Toggle theme in settings
  - Persistenza preferenza (localStorage + database)
  - DaisyUI theme switching
  - Smooth transition
- **Priorità**: BASSA 🟢

#### 5.4 Mobile Optimization
- **Implementazione**:
  - Responsive design migliorato
  - Touch gestures (swipe per eliminare)
  - Bottom navigation per mobile
  - Ottimizzazione viewport e font sizes
- **Priorità**: MEDIA 🟡

#### 5.5 PWA Support
- **Implementazione**:
  - Service worker per offline support
  - App manifest
  - Installable app
  - Push notifications browser
  - Background sync
- **Priorità**: BASSA 🟢

#### 5.6 Onboarding & Empty States
- **Implementazione**:
  - Tutorial primo utilizzo
  - Empty state illustrate con CTA
  - Tooltips per funzionalità avanzate
  - Tour guidato (react-joyride)
- **Priorità**: BASSA 🟢

---

## 6. Nuove Feature (Enhancement)

#### 6.1 Categorie e Tag Prodotti
- **Implementazione**:
  - Tabella `product_categories` e `product_tags`
  - UI per assegnare categoria/tag
  - Filtro dashboard per categoria
  - Categorie predefinite (Elettronica, Abbigliamento, ecc.)
  - Tag personalizzabili
- **Priorità**: MEDIA 🟡

#### 6.2 Preferiti e Priorità
- **Implementazione**:
  - Flag `is_favorite` su prodotto
  - Sezione "Preferiti" in dashboard
  - Livelli di priorità (alta, media, bassa)
  - Check più frequenti per prodotti prioritari
- **Priorità**: BASSA 🟢

#### 6.3 Statistiche e Analytics
- **Implementazione**:
  - Dashboard analytics:
    - Risparmio totale
    - Miglior affare della settimana
    - Trend prezzi generale
    - Store più conveniente
  - Chart comparativi
  - Export report PDF
- **Prioritità**: BASSA 🟢
- **File da creare**: `/home/user/PriceTracker/client/src/pages/Analytics.jsx`

#### 6.4 Confronto Prezzi Multi-Store
- **Implementazione**:
  - Ricerca automatica stesso prodotto su più store
  - Tabella comparativa prezzi
  - Badge "Miglior prezzo"
  - Notifica se altro store più conveniente
- **Priorità**: MEDIA 🟡

#### 6.5 Price Prediction
- **Implementazione**:
  - Algoritmo ML per predire trend prezzi
  - "Migliore momento per comprare"
  - Analisi storica pattern stagionali
  - Integrazione con eventi (Black Friday, Prime Day)
- **Priorità**: BASSA 🟢

#### 6.6 Supporto Multi-Currency
- **Implementazione**:
  - Rilevamento automatico valuta prodotto
  - API conversione tassi (exchangerate-api.com)
  - Valuta preferita utente
  - Normalizzazione prezzi per confronti
- **Priorità**: MEDIA 🟡

#### 6.7 Wishlist Condivise
- **Implementazione**:
  - Creazione liste prodotti
  - Share link pubblico/privato
  - Collaborazione multi-utente
  - Permission system
- **Priorità**: BASSA 🟢

#### 6.8 Export/Import Dati
- **Implementazione**:
  - Export prodotti e storico prezzi (CSV, JSON)
  - Import bulk da file
  - Backup automatico dati utente
  - GDPR compliance (data portability)
- **Priorità**: MEDIA 🟡

#### 6.9 Estensione Browser
- **Implementazione**:
  - Estensione Chrome/Firefox
  - Aggiunta prodotto con un click
  - Notifiche desktop
  - Comparazione prezzi inline su siti
- **Priorità**: BASSA 🟢

#### 6.10 Supporto Nuovi Store
- **Stato**: Solo Amazon e Swappie supportati
- **Store da aggiungere**:
  - eBay
  - AliExpress
  - Zalando
  - MediaWorld
  - Unieuro
  - ePrice
  - Store locali italiani
- **Implementazione**:
  - Scraper modulari per store
  - Plugin system per aggiungere store
  - Community contributions
- **Priorità**: ALTA 🟡

#### 6.11 CAPTCHA Handling
- **Problema**: Scraper fallisce con CAPTCHA
- **Implementazione**:
  - Servizio CAPTCHA solving (2Captcha, Anti-Captcha)
  - Rotazione User-Agent più sofisticata
  - Proxy rotation
  - Browser fingerprint randomization
- **Priorità**: ALTA 🟡
- **File**: `/home/user/PriceTracker/server/services/scraper.js`

---

## 7. Testing & Quality Assurance

#### 7.1 Unit Testing
- **Stato**: Zero test coverage
- **Implementazione**:
  - Vitest per testing (già in devDependencies)
  - Test utilities (parsePrice, formatters)
  - Test servizi (scraper, priceTracker)
  - Test componenti React (React Testing Library)
  - Coverage > 70%
- **Priorità**: ALTA 🟡
- **Directory**: `/home/user/PriceTracker/client/src/__tests__/`, `/home/user/PriceTracker/server/__tests__/`

#### 7.2 Integration Testing
- **Implementazione**:
  - Test API endpoints
  - Test database operations
  - Test Supabase Auth flow
  - Test scheduled functions
- **Priorità**: MEDIA 🟡

#### 7.3 E2E Testing
- **Implementazione**:
  - Playwright o Cypress
  - Test user flows principali:
    - Signup/Login
    - Aggiungi prodotto
    - Visualizza dettaglio
    - Modifica settings
  - Test su multiple browser
- **Priorità**: MEDIA 🟡

#### 7.4 Visual Regression Testing
- **Implementazione**:
  - Percy o Chromatic
  - Snapshot test componenti UI
- **Priorità**: BASSA 🟢

---

## 8. DevOps & Deployment

#### 8.1 CI/CD Pipeline
- **Implementazione**:
  - GitHub Actions workflow:
    - Lint su PR
    - Test automatici
    - Build verification
    - Deploy staging su PR
    - Deploy production su merge
  - Pre-commit hooks (Husky)
  - Conventional commits
- **Priorità**: ALTA 🟡
- **File da creare**: `.github/workflows/ci.yml`

#### 8.2 Environment Staging
- **Implementazione**:
  - Ambiente staging separato
  - Database staging Supabase
  - Deploy automatico branch staging
  - Test su staging prima di production
- **Priorità**: MEDIA 🟡

#### 8.3 Monitoring & Observability
- **Implementazione**:
  - Error tracking (Sentry)
  - Application metrics (Datadog, New Relic)
  - Uptime monitoring (Uptime Robot)
  - Log aggregation (Logtail, Papertrail)
  - Performance monitoring (Web Vitals)
- **Priorità**: ALTA 🟡

#### 8.4 Alerting System
- **Implementazione**:
  - Alert su:
    - Scraper failure rate > 50%
    - API errors > soglia
    - Database down
    - Scheduled function failures
  - Canali: Email, Slack, PagerDuty
- **Priorità**: MEDIA 🟡

#### 8.5 Database Migrations
- **Problema**: SQL manualmente eseguiti
- **Implementazione**:
  - Sistema migration (Supabase migrations o dbmate)
  - Version control per schema changes
  - Rollback capability
  - Seed data per development
- **Priorità**: ALTA 🟡
- **Directory**: `/home/user/PriceTracker/server/database/migrations/`

#### 8.6 Infrastructure as Code
- **Implementazione**:
  - Terraform o Pulumi per Supabase config
  - Version control configurazioni Netlify
  - Reproducible environments
- **Priorità**: BASSA 🟢

---

## 9. Documentazione

#### 9.1 API Documentation
- **Implementazione**:
  - OpenAPI/Swagger spec
  - Endpoint documentation
  - Request/response examples
  - Authentication flow
- **Priorità**: MEDIA 🟡
- **File da creare**: `/home/user/PriceTracker/docs/API.md`

#### 9.2 Architecture Documentation
- **Implementazione**:
  - Diagrammi architettura (C4 model)
  - Data flow diagrams
  - Database ERD
  - Deployment architecture
- **Priorità**: MEDIA 🟡
- **File da creare**: `/home/user/PriceTracker/docs/ARCHITECTURE.md`

#### 9.3 Contributing Guidelines
- **Implementazione**:
  - CONTRIBUTING.md
  - Code style guide
  - PR template
  - Issue templates
  - Development setup completo
- **Priorità**: BASSA 🟢
- **File da creare**: `/home/user/PriceTracker/CONTRIBUTING.md`

#### 9.4 User Documentation
- **Implementazione**:
  - Guida utente
  - FAQ
  - Troubleshooting
  - Video tutorial
- **Priorità**: BASSA 🟢

#### 9.5 Code Comments & JSDoc
- **Stato**: Pochi commenti nel codice
- **Implementazione**:
  - JSDoc per funzioni pubbliche
  - Commenti per logica complessa
  - Type definitions (JSDoc o TypeScript)
- **Priorità**: MEDIA 🟡

#### 9.6 README Improvements
- **Problema**: README incompleto, manca database setup
- **Implementazione**:
  - Guida setup completa passo-passo
  - Prerequisites chiari
  - Environment variables documentation
  - Database setup e migrations
  - Troubleshooting comune
  - Screenshots/GIF applicazione
- **Priorità**: ALTA 🟡
- **File**: `/home/user/PriceTracker/README.md`

---

## 10. Refactoring Tecnico

#### 10.1 TypeScript Migration
- **Motivazione**: Type safety, better DX
- **Implementazione**:
  - Graduale migrazione da JavaScript
  - Iniziare da utilities e servizi
  - Strict mode TypeScript
  - Shared types tra client/server
- **Priorità**: MEDIA 🟡

#### 10.2 Monorepo Structure
- **Implementazione**:
  - Workspace con pnpm/npm workspaces
  - Shared packages:
    - `@pricetracker/types`
    - `@pricetracker/utils`
    - `@pricetracker/config`
  - Better code reuse
- **Priorità**: BASSA 🟢

#### 10.3 Component Refactoring
- **Problema**: ProductDetail.jsx troppo grande (422 righe)
- **Implementazione**:
  - Scomporre in componenti più piccoli:
    - `ProductHeader.jsx`
    - `ProductImage.jsx`
    - `PriceChart.jsx`
    - `ProductSettings.jsx`
    - `ProductFeatures.jsx`
  - Custom hooks per logica riutilizzabile
- **Priorità**: MEDIA 🟡
- **File**: `/home/user/PriceTracker/client/src/pages/ProductDetail.jsx`

#### 10.4 Shared Utilities
- **Problema**: `parsePrice` duplicato tra client e server
- **Implementazione**:
  - Creare package condiviso
  - Utilities comuni in un unico posto
  - Import da package invece di duplicazione
- **Priorità**: MEDIA 🟡

#### 10.5 Scraper Refactoring
- **Problema**: Selectors hardcoded, fragili
- **Implementazione**:
  - Store-specific scraper classes
  - Strategy pattern per diversi store
  - Configuration-driven selectors
  - Fallback chains
  - Plugin architecture
- **Priorità**: ALTA 🟡
- **File**: `/home/user/PriceTracker/server/services/scraper.js`

#### 10.6 Environment Validation
- **Implementazione**:
  - Libreria env validation (envalid, zod)
  - Fail-fast su env mancanti/invalidi
  - Type-safe access a variabili ambiente
- **Priorità**: ALTA 🟡

#### 10.7 Error Handling Standardization
- **Implementazione**:
  - Custom Error classes
  - Error codes standardizzati
  - Consistent error responses API
  - Error logging middleware
- **Priorità**: MEDIA 🟡

#### 10.8 Design System & Component Library
- **Implementazione**:
  - Componenti atomici riutilizzabili
  - Storybook per component showcase
  - Design tokens (colori, spacing, typography)
  - Consistent styling
- **Priorità**: BASSA 🟢

---

## 📊 Riepilogo Priorità

### 🔴 CRITICHE (Da fare SUBITO)
1. Sicurezza file `.env`
2. CORS configuration
3. Netlify cron frequency
4. Input validation & sanitization
5. Rate limiting
6. Database policies verification

### 🟡 ALTE (Da fare a breve)
1. Sistema notifiche email
2. Database indexing
3. Supporto nuovi store
4. CAPTCHA handling
5. CI/CD pipeline
6. Monitoring & error tracking
7. README improvements
8. Database migrations system
9. Scraper refactoring
10. Testing infrastructure

### 🟢 MEDIE (Pianificare)
1. UI notifiche
2. Paginazione
3. Caching layer
4. Performance optimization
5. UX improvements
6. Multi-currency support
7. Export/import
8. TypeScript migration
9. Component refactoring
10. Documentation

### ⚪ BASSE (Future nice-to-have)
1. PWA support
2. Dark/light mode toggle
3. Analytics dashboard
4. Price prediction
5. Wishlist condivise
6. Browser extension
7. Design system

---

## 🎯 Roadmap Suggerita

### Phase 1 - Stabilizzazione (2-3 settimane)
- Fix sicurezza critici
- Input validation
- Rate limiting
- Database indexes
- Monitoring setup
- CI/CD base

### Phase 2 - Core Features (3-4 settimane)
- Sistema email notifiche
- UI notifiche
- Paginazione
- Testing infrastructure
- README e documentazione

### Phase 3 - Scaling (4-6 settimane)
- Caching layer
- Performance optimization
- Supporto nuovi store
- CAPTCHA handling
- Scraper refactoring
- Database migrations

### Phase 4 - Enhancement (ongoing)
- Nuove feature utente
- TypeScript migration
- PWA support
- Analytics avanzate
- Community features

---

**Documento creato**: 2025-12-14
**Versione**: 1.0
**Ultimo aggiornamento**: 2025-12-14

*Per contribuire o discutere queste implementazioni, aprire una issue o PR sul repository.*
