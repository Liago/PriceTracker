# Advanced Scraping System

Documentazione del sistema di scraping avanzato implementato in PriceTracker.

## Panoramica

Il sistema di scraping è stato potenziato con funzionalità avanzate per migliorare l'affidabilità e gestire le protezioni anti-bot dei siti web.

### Features

| Feature | Descrizione |
|---------|-------------|
| **User-Agent Rotation** | Pool di 15 User-Agent realistici con cambio automatico |
| **Proxy Support** | Supporto opzionale per rotazione proxy |
| **CAPTCHA Detection** | Rilevamento multi-pattern di vari tipi di CAPTCHA |
| **Retry Logic** | Tentativi automatici con exponential backoff |
| **Stealth Mode** | Plugin stealth per evitare detection |

---

## Architettura

```
server/
├── services/
│   └── scraper.js          # Core scraper con retry logic
├── utils/
│   ├── userAgentManager.js # Gestione User-Agent rotation
│   ├── proxyManager.js     # Gestione proxy opzionale
│   └── captchaDetector.js  # Detection CAPTCHA avanzato
└── config/
    └── env.js              # Configurazione environment
```

---

## User-Agent Rotation

### Descrizione

Il modulo `userAgentManager` fornisce un pool di User-Agent realistici da browser comuni:

- **Chrome** (Windows, Mac) - versioni 118-120
- **Firefox** (Windows, Mac) - versioni 120-121
- **Safari** (Mac) - versione 17
- **Edge** (Windows) - versioni 119-120

### Utilizzo

```javascript
const { userAgentManager } = require('./utils/userAgentManager');

// User-Agent casuale
const ua = userAgentManager.getRandomUserAgent();

// User-Agent ottimizzato per URL specifico
const ua = userAgentManager.getUserAgentForUrl('https://amazon.it/...');

// User-Agent diverso (per retry)
const ua = userAgentManager.getNextUserAgent();
```

### Preferenze per Store

Alcuni store funzionano meglio con determinati browser:

| Store | Browser Preferiti |
|-------|-------------------|
| Amazon | Chrome, Edge |
| eBay | Chrome, Firefox |
| AliExpress | Chrome |

---

## Proxy Support

### Descrizione

Il modulo `proxyManager` permette di utilizzare proxy per le richieste, utile per:
- Evitare rate limiting basato su IP
- Aggirare blocchi geografici
- Distribuire il carico su più IP

### Configurazione

Aggiungi al file `.env`:

```bash
# Formato: host:port oppure host:port:username:password
PROXY_LIST=proxy1.example.com:8080,proxy2.example.com:8080:user:pass

# Oppure formato URL
PROXY_LIST=http://user:pass@proxy1.example.com:8080
```

### Utilizzo

```javascript
const { createProxyManagerFromEnv } = require('./utils/proxyManager');

const proxyManager = createProxyManagerFromEnv();

if (proxyManager.hasProxies()) {
    const proxy = proxyManager.getRandomProxy();
    // Usa proxy...
    
    // Se fallisce
    proxyManager.markCurrentAsFailed();
}
```

### Formati Supportati

| Formato | Esempio |
|---------|---------|
| Base | `host:port` |
| Con auth | `host:port:username:password` |
| URL | `http://user:pass@host:port` |

---

## CAPTCHA Detection

### Descrizione

Il modulo `captchaDetector` rileva la presenza di CAPTCHA analizzando:

1. **Titolo pagina** - Pattern come "captcha", "security check", "robot"
2. **URL** - Pattern come "/captcha", "/challenge"
3. **Selettori DOM** - iframe reCAPTCHA, elementi Cloudflare, etc.
4. **Contenuto testo** - Frasi come "verify you are a human"

### Tipi di CAPTCHA Rilevati

| Tipo | Indicatori |
|------|------------|
| **reCAPTCHA** | iframe google recaptcha, classe .g-recaptcha |
| **hCaptcha** | iframe hcaptcha, classe .h-captcha |
| **Cloudflare** | elementi cf-*, iframe challenges.cloudflare |
| **DataDome** | iframe datadome |
| **PerimeterX** | iframe px-captcha |
| **Amazon** | form validateCaptcha |

### Utilizzo

```javascript
const { captchaDetector } = require('./utils/captchaDetector');

const result = await captchaDetector.detect(page);

if (result.detected) {
    console.log(`CAPTCHA: ${result.type}`);
    console.log(`Confidence: ${result.confidence}%`);
    console.log(`Indicators:`, result.indicators);
}
```

### Struttura Risultato

```javascript
{
    detected: true,
    type: 'reCAPTCHA',
    confidence: 70,  // 0-100
    indicators: [
        { type: 'selector', selector: 'iframe[src*="recaptcha"]', visible: true },
        { type: 'title', pattern: 'security', value: 'Security Check' }
    ],
    url: 'https://example.com/...',
    timestamp: '2026-01-28T16:00:00Z'
}
```

---

## Retry Logic

### Descrizione

Lo scraper implementa retry automatico con exponential backoff:

```
Delay = base * 2^attempt + random_jitter
```

### Configurazione

```bash
# .env
SCRAPER_MAX_RETRIES=3      # Numero massimo tentativi
SCRAPER_RETRY_DELAY=1000   # Delay base in ms
```

### Condizioni per Retry

Il retry viene attivato automaticamente su:

- ✅ CAPTCHA rilevato
- ✅ Errori di rete (`net::ERR_*`)
- ✅ Timeout di navigazione
- ✅ Errori di protocollo

### Comportamento

| Tentativo | Delay (base 1s) | Delay con jitter |
|-----------|-----------------|------------------|
| 1° | 1s | 1-2s |
| 2° | 2s | 2-3s |
| 3° | 4s | 4-5s |

> Il delay massimo è cappato a 30 secondi.

---

## Configurazione Completa

### Variabili di Ambiente

Aggiungi al file `.env`:

```bash
# ═══════════════════════════════════════════════════════
# ADVANCED SCRAPING CONFIGURATION
# ═══════════════════════════════════════════════════════

# Lista proxy (opzionale, comma-separated)
PROXY_LIST=

# Retry configuration
SCRAPER_MAX_RETRIES=3
SCRAPER_RETRY_DELAY=1000
```

### Valori di Default

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PROXY_LIST` | `''` (vuoto) | Nessun proxy, connessione diretta |
| `SCRAPER_MAX_RETRIES` | `3` | 3 tentativi totali |
| `SCRAPER_RETRY_DELAY` | `1000` | 1 secondo base delay |

---

## API

### getScraperStats()

Restituisce statistiche sul sistema di scraping:

```javascript
const { getScraperStats } = require('./services/scraper');

const stats = getScraperStats();
// {
//     captcha: {
//         totalDetections: 5,
//         byType: { 'reCAPTCHA': 3, 'Cloudflare': 2 },
//         recentDetections: [...]
//     },
//     proxy: {
//         total: 2,
//         failed: 0,
//         available: 2
//     },
//     userAgentCount: 15
// }
```

---

## Best Practices

### 1. Inizia senza Proxy

Il sistema funziona bene senza proxy grazie a:
- StealthPlugin attivo
- User-Agent rotation
- Retry automatico

### 2. Aggiungi Proxy se Necessario

Se noti frequenti CAPTCHA o blocchi:
1. Configura `PROXY_LIST` con proxy residenziali
2. Monitora i log per vedere quale proxy fallisce

### 3. Monitora i Log

Cerca questi pattern nei log:

```
[Scraper] CAPTCHA detected (reCAPTCHA), confidence: 70%
[Scraper] Retrying in 2s...
[ProxyManager] Marked proxy 0 as failed
```

### 4. Non Eccedere con le Richieste

Anche con retry e proxy, rispetta rate limit ragionevoli per evitare blocchi permanenti.

---

## Troubleshooting

### CAPTCHA Frequenti

1. Verifica che StealthPlugin sia attivo
2. Aumenta `SCRAPER_RETRY_DELAY`
3. Aggiungi proxy residenziali

### Timeout Frequenti

1. Aumenta il timeout in `scraper.js` (default 30s)
2. Verifica connessione/proxy
3. Controlla se il sito è molto lento

### Proxy Non Funziona

1. Verifica formato in `PROXY_LIST`
2. Testa proxy manualmente
3. Controlla autenticazione se richiesta

---

## Roadmap Future

- [ ] Integrazione 2Captcha per solving automatico
- [ ] Dashboard stats CAPTCHA
- [ ] Pool proxy dinamico da API
- [ ] Machine learning per ottimizzare User-Agent selection
