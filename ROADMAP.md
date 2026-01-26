# ROADMAP

Questo documento unisce e riorganizza le funzionalità e i miglioramenti previsti per **PriceTracker**, basandosi su `FEATURES.md` (2026-01-25) e `IMPLEMENTATIONS.md` (2025-12-14).
Le priorità sono state aggiornate considerando l'analisi più recente. I test, come richiesto, sono in fondo alla lista.

---

## 🟢 Completati

### Sicurezza e Configurazione
- [x] **Sicurezza File Ambiente**: `.env` in gitignore, `.env.example` creato, rimossi dalla history.
- [x] **Database Policies**: Applicate policy RLS e verifiche.
- [x] **CORS**: Limitato ai domini autorizzati.
- [x] **Service Role Key**: Protetta e rimossa dal client.
- [x] **URL & Input Validation**: Whitelist domini, sanitizzazione input, protezione URL injection.
- [x] **Rate Limiting**: Implementato su API endpoints.

### Backend & Core
- [x] **Cron Schedule**: Ottimizzata frequenza esecuzione.
- [x] **Scraper Refactoring**: Implementato pattern Strategy, scraper specifici per store, selettori configurabili.
- [x] **Notifiche Email Base**: Integrazione Nodemailer, template HTML, invio su drop prezzo.
- [x] **Database Indexing**: Aggiunti indici su `user_id`, `product_id`, `recorded_at`.

---

## 🔴 Priorità Critica (Da fare subito)

### DevEx & Stabilità
- [ ] **CI/CD Pipeline**: 
  - GitHub Actions per lint, test, build.
  - Deploy automatico.
  - Pre-commit hooks (Husky).
- [ ] **Monitoring e Error Tracking**:
  - Integrazione Sentry.
  - Logging strutturato.
  - Alert su fallimenti scraper > 50%.
- [x] **Error Boundaries React**: 
  - Componente globale per gestire crash.
  - Fallback UI.
- [x] **Environment Validation Aggiornata**:
  - Validazione `zod` o `envalid` rigorosa all'avvio (segnalato come necessario nonostante il lavoro parziale precedente).

---

## 🟠 Priorità Alta (Pianificare a breve)

### Funzionalità Core Mancanti
- [ ] **UI Sistema Notifiche**:
  - `NotificationBell` con badge.
  - Pagina `/notifications` per storico.
  - Gestione letto/non letto.
- [ ] **Supporto Nuovi Store**:
  - eBay, MediaWorld, Unieuro, Zalando, AliExpress, ePrice.
- [ ] **Gestione CAPTCHA & Scraping Avanzato**:
  - Integrazione servizi solving (2Captcha).
  - Rotazione User-Agent e Proxy.
  - Browser fingerprinting.
- [ ] **Paginazione Dashboard**:
  - Server-side pagination con Supabase.
  - Infinite scroll (mobile) vs Paginazione classica.
- [ ] **Database Migrations System**:
  - Versionamento schema DB (Supabase CLI o dbmate).
  - Seed data.
- [ ] **Documentazione & README**:
  - Guida setup completa.
  - Troubleshooting.
  - Architettura alto livello.

---

## 🟡 Priorità Media

### Performance & UX
- [ ] **Sistema di Caching**: Redis (Upstash) per prodotti e scraping results.
- [ ] **Loading States & Skeleton UI**: Feedback visivo consistente, optimistic updates.
- [ ] **Ottimizzazione Mobile**: Bottom navigation, touch gestures, layout fix.
- [ ] **Notifiche Avanzate**: Variazione significativa, restock, digest periodici.
- [ ] **Categorie e Tag**: Organizzazione prodotti, filtri dashboard.
- [ ] **Supporto Multi-Valuta**: Conversione automatica, display valuta originale.
- [ ] **Export/Import Dati**: CSV/JSON, backup, GDPR portability.

### Refactoring Tecnico
- [ ] **TypeScript Migration**: Migrazione graduale a TS (strict mode).
- [ ] **Component Refactoring**: Scomposizione `ProductDetail` e `Dashboard`.
- [ ] **Content Security Policy (CSP)**: Headers sicurezza su Netlify.
- [ ] **Utilities Condivise**: Package `@pricetracker/utils` per evitare duplicazioni (es. `parsePrice`).
- [ ] **Error Handling Standard**: Classi errore custom, response uniformi.
- [ ] **API Documentation**: OpenAPI/Swagger specs.

---

## 🟢 Priorità Bassa / Future

### Feature Avanzate
- [ ] **PWA Support**: Offline support, installabilità.
- [ ] **Dark/Light Mode**: Toggle tema utente.
- [ ] **Dashboard Analytics**: Grafici risparmio, trend, store più convenienti.
- [ ] **Confronto Multi-Store**: Matching automatico stesso prodotto.
- [ ] **Price Prediction**: ML per suggerimento momento acquisto.
- [ ] **Wishlist Condivise**: Liste pubbliche/private collaborative.
- [ ] **Estensione Browser**: Aggiunta rapida prodotti.
- [ ] **Design System / Storybook**: Documentazione componenti UI.
- [ ] **Onboarding**: Tutorial guidato per nuovi utenti.

---

## 🧪 Testing (Priorità Critica ma in fondo alla lista)

Il progetto ha attualmente **zero test coverage**.
- [ ] **Unit Test**: Vitest per utilities e validatori.
- [ ] **Component Test**: React Testing Library.
- [ ] **API Test**: Supertest per endpoints.
- [ ] **E2E Test**: Playwright per flussi critici.
- [ ] **Scraper Test**: Test specifici per ogni integratore.
- [ ] **Target Coverage**: >70%.
