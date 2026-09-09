/**
 * Ottenere e interpretare una pagina prodotto, a tier.
 *
 * Il motore non ha piu' codice dedicato per nessuno store: il browser - o la
 * GET - servono solo a OTTENERE l'HTML, e a leggerlo e' la pipeline generica
 * guidata dalla ricetta del dominio.
 *
 * Due tier, in ordine di costo:
 *
 *   Tier 0 - una GET HTTP. Costa meno di un secondo e basta per ogni pagina
 *            che espone JSON-LD, microdata o Open Graph, cioe' la grande
 *            maggioranza degli shop e tutte le ricette seminate.
 *   Tier 1 - Chromium. Serve alle pagine che il prezzo lo costruiscono in
 *            JavaScript, e a quelle che rispondono 403 a chi non e' un browser.
 *
 * Il tier 1 non e' gratis e in produzione non e' nemmeno sempre possibile: una
 * function sincrona di Netlify vive dieci secondi, e avviare Chromium ne costa
 * gia' diversi. Da qui il budget: ogni chiamata riceve una scadenza e la
 * rispetta, salendo di tier solo se resta tempo per arrivare in fondo. Quando
 * il tempo non basta si restituisce il miglior risultato ottenuto, o si fallisce
 * con un errore riconoscibile - non si lascia che sia il proxy a troncare la
 * connessione, perche' quello produce un 504 con una pagina HTML al posto di
 * una risposta, e nessuna informazione su cosa sia andato storto.
 */

const puppeteerCore = require('puppeteer-core');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const { userAgentManager } = require('../utils/userAgentManager');
const { createProxyManagerFromEnv } = require('../utils/proxyManager');
const { captchaDetector } = require('../utils/captchaDetector');
const { resolveLocalExecutablePath } = require('../utils/browserPath');
const { interpret } = require('../scrape');
const { fetchHtml } = require('../scrape/fetchHtml');
const { detectInHtml } = require('../scrape/antiBot');

// Configuration
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES || '3', 10);
const RETRY_DELAY_BASE = parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10);

// La soglia sotto la quale il fast path non basta e si passa alla scoperta.
const FAST_PATH_THRESHOLD = parseFloat(process.env.SCRAPE_FAST_PATH_THRESHOLD || '0.85');

// La soglia sotto la quale il risultato del tier 0 non basta e si sale al
// browser. Piu' bassa del fast path: qui non si sta scegliendo fra due
// strategie ma fra un risultato e nessun risultato.
const TIER0_THRESHOLD = parseFloat(process.env.SCRAPE_TIER0_THRESHOLD || '0.6');

// Quanto si concede alla GET prima di rinunciare e passare al browser.
const TIER0_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIER0_TIMEOUT_MS || '6000', 10);

// Il tier 0 si disattiva con SCRAPE_TIER0=off, senza deploy.
const TIER0_ENABLED = (process.env.SCRAPE_TIER0 || 'on').toLowerCase() !== 'off';

// Budget di default di una singola chiamata. Sotto i dieci secondi delle
// function sincrone di Netlify, con margine per la risposta.
const DEFAULT_BUDGET_MS = parseInt(process.env.SCRAPE_REQUEST_BUDGET_MS || '9000', 10);

// Sotto questo tempo residuo non ha senso avviare Chromium: si spenderebbe
// tutto il budget nell'avvio, per poi essere troncati durante la navigazione.
const BROWSER_MIN_MS = parseInt(process.env.SCRAPE_BROWSER_MIN_MS || '8000', 10);

// Tempo lasciato alla risposta dopo l'ultima lettura: chiusura del browser,
// scritture, serializzazione.
const RESPONSE_RESERVE_MS = parseInt(process.env.SCRAPE_RESPONSE_RESERVE_MS || '2500', 10);

// Sotto questo tempo una navigazione non ha senso: si troncherebbe, e una
// pagina troncata non e' un risultato ma un errore che costa quanto un
// successo.
const NAVIGATION_MIN_MS = parseInt(process.env.SCRAPE_NAVIGATION_MIN_MS || '4000', 10);

/** Errore riconoscibile: il budget e' finito prima di un risultato. */
const BUDGET_EXCEEDED = 'SCRAPE_BUDGET_EXCEEDED';

/**
 * Quanto e' costato l'ultimo avvio di Chromium, in questo processo.
 *
 * BROWSER_MIN_MS e' una stima tarata sull'avvio a freddo, quando il binario va
 * decompresso in /tmp. Su un container gia' caldo lo stesso avvio costa qualche
 * centinaio di millisecondi, e usare la stima significava dichiarare
 * «budget insufficiente» con otto secondi ancora liberi: il ritentativo con un
 * altro User-Agent - la difesa prevista contro l'anti-bot - non e' mai partito
 * nemmeno una volta.
 *
 * Il valore osservato sostituisce la stima appena ce n'e' uno. E' per processo,
 * quindi si azzera con il container: la prima invocazione a freddo usa la
 * stima, che e' esattamente il caso in cui la stima e' giusta.
 */
let observedBrowserStartMs = null;

/**
 * Il tempo residuo sotto il quale non ha senso avviare il browser.
 * @returns {number}
 */
function browserBudgetNeeded() {
	if (observedBrowserStartMs === null) return BROWSER_MIN_MS;
	// Un terzo di margine sull'avvio osservato: varia fra invocazioni.
	return Math.ceil(observedBrowserStartMs * 1.33) + NAVIGATION_MIN_MS + RESPONSE_RESERVE_MS;
}

/**
 * Quanto aspettare prima di riprovare.
 *
 * Su una sfida anti-bot il backoff esponenziale e' la cura sbagliata: non si
 * sta aspettando che un servizio sovraccarico si riprenda, si sta cambiando
 * identita', e il cambio di User-Agent e' immediato. Attendere due secondi
 * consuma il budget che serve al tentativo stesso. Sugli errori di rete il
 * backoff resta quello di prima.
 */
function retryDelay(error, attempt) {
	if (error.message.includes('CAPTCHA_DETECTED')) return CHALLENGE_RETRY_MS;
	return getBackoffDelay(attempt);
}

/** Pausa fra due tentativi su una sfida: non aggressiva, non sprecona. */
const CHALLENGE_RETRY_MS = parseInt(process.env.SCRAPE_CHALLENGE_RETRY_MS || '500', 10);

/**
 * Il tier 1 e' raggiungibile con questa configurazione?
 *
 * La risposta ha due gradi, ed e' bene non confonderli - una versione
 * precedente di questo avviso diceva «il browser non parte mai», che e' falso
 * e in produzione si e' visto subito: quando un sito rifiuta la GET con un 403
 * il tier 0 fallisce in poche centinaia di millisecondi, il residuo resta alto
 * e il browser parte eccome.
 *
 * - `sempre`: il budget copre una GET portata al suo limite PIU' l'avvio del
 *   browser. Il tier 1 e' disponibile qualunque cosa faccia il tier 0.
 * - `solo se il tier 0 rinuncia in fretta`: il budget copre l'avvio del
 *   browser ma non entrambi. Il caso comune sulle function sincrone: si arriva
 *   al browser quando il sito risponde subito con un blocco, non quando la
 *   pagina e' semplicemente lenta.
 * - `mai`: il budget non copre nemmeno l'avvio. Esiste solo il tier 0.
 *
 * @returns {{level: 'sempre'|'condizionato'|'mai', needsForAlways: number}}
 */
function browserReachability() {
	const needed = browserBudgetNeeded();
	const needsForAlways = TIER0_TIMEOUT_MS + needed;
	if (DEFAULT_BUDGET_MS >= needsForAlways) return { level: 'sempre', needsForAlways, needed };
	if (DEFAULT_BUDGET_MS >= needed) return { level: 'condizionato', needsForAlways, needed };
	return { level: 'mai', needsForAlways, needed };
}

/** @returns {boolean} vero solo se il tier 1 e' disponibile in ogni caso. */
function browserReachable() {
	return browserReachability().level === 'sempre';
}

{
	const { level, needsForAlways } = browserReachability();
	if (level === 'condizionato') {
		console.warn(
			`[Scraper] Con SCRAPE_REQUEST_BUDGET_MS=${DEFAULT_BUDGET_MS} il browser parte solo quando il tier 0 `
			+ `rinuncia in fretta (un blocco del sito), non quando la pagina e' lenta: servirebbero ${needsForAlways}ms `
			+ `per averlo sempre. E quando parte gli resta poco per navigare, quindi rischia di leggere una pagina a meta'.`,
		);
	} else if (level === 'mai') {
		console.warn(
			`[Scraper] Con SCRAPE_REQUEST_BUDGET_MS=${DEFAULT_BUDGET_MS} il browser non parte mai `
			+ `(ne servono almeno ${browserBudgetNeeded()} solo per avviarlo). Esiste solo il tier 0.`,
		);
	}
}

// Initialize proxy manager
const proxyManager = createProxyManagerFromEnv();
if (proxyManager.hasProxies()) {
	console.log(`[Scraper] Proxy manager initialized with ${proxyManager.getStats().total} proxies`);
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
	// Exponential backoff with jitter: base * 2^attempt + random jitter
	const exponentialDelay = RETRY_DELAY_BASE * Math.pow(2, attempt);
	const jitter = Math.random() * 1000; // 0-1 second jitter
	return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

/**
 * Create browser instance with optional proxy
 * @param {Object|null} proxy - Proxy configuration
 * @returns {Promise<Browser>}
 */
async function createBrowser(proxy = null) {
	const isProduction = process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.NETLIFY;

	if (isProduction) {
		const chromium = require('@sparticuz/chromium');
		const lambdaArgs = [
			...chromium.args,
			'--single-process',
			'--disable-dev-shm-usage',
			'--no-zygote',
			...(proxy ? proxyManager.getProxyArgs(proxy) : []),
		];

		return puppeteer.launch({
			args: lambdaArgs,
			defaultViewport: chromium.defaultViewport,
			executablePath: await chromium.executablePath(),
			headless: chromium.headless,
			ignoreHTTPSErrors: true,
		});
	} else {
		// Local Development
		const localExecutablePath = resolveLocalExecutablePath();
		if (localExecutablePath) {
			console.log(`[Scraper] Chrome locale: ${localExecutablePath}`);
		} else {
			console.log('[Scraper] Nessun Chrome trovato nei path noti, risoluzione lasciata a puppeteer (channel: chrome)');
		}

		return puppeteer.launch({
			channel: 'chrome',
			// Omesso quando non risolto: in puppeteer-core executablePath ha la
			// precedenza su channel, quindi passarlo undefined e' cio' che
			// permette al fallback per channel di entrare in gioco.
			...(localExecutablePath ? { executablePath: localExecutablePath } : {}),
			headless: 'new',
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				...(proxy ? proxyManager.getProxyArgs(proxy) : []),
			]
		});
	}
}

/**
 * Da questo HTML e' arrivata una pagina, o solo il suo guscio?
 *
 * E' la domanda che separa «questa pagina non ha un prezzo» - un giudizio, che
 * presuppone di aver visto la pagina - da «non sono riuscito a leggerla». La
 * regola vale per entrambi i tier: un browser che restituisce un documento
 * vuoto non e' piu' informativo di una GET che torna vuota, e per un po' lo
 * e' stato soltanto perche' il controllo esisteva solo al tier 0.
 *
 * Zero candidati da sette estrattori indipendenti basta da solo: su un HTML
 * reale non capita, perche' anche una pagina «chi siamo» produce un titolo.
 * La dimensione non basta mai da sola - le fixture di questo progetto stanno
 * in poco piu' di un kilobyte e si leggono benissimo - ma conta insieme
 * all'assenza di qualunque candidato prezzo.
 *
 * Non basta nemmeno l'assenza del solo prezzo su una pagina piena: una scheda
 * legittima puo' non averlo (esaurito, prezzo su richiesta), e quella e'
 * un'altra risposta, che spetta a chi chiama.
 *
 * @param {object} data - uscita di interpret()
 * @param {object} inspection - uscita di detectInHtml()
 * @returns {{usable: boolean, reason: string|null}}
 */
function inspectResult(data, inspection) {
	const candidates = data.candidates || [];

	if (candidates.length === 0) return { usable: false, reason: 'nessun_candidato' };

	const noPrice = !candidates.some((candidate) => candidate.field === 'price');
	if (inspection.reason === 'pagina_troppo_piccola' && noPrice) {
		return { usable: false, reason: 'pagina_troppo_piccola' };
	}

	return { usable: true, reason: null };
}

/**
 * Tier 0: la pagina via GET, interpretata dalla pipeline.
 *
 * @param {string} url
 * @param {object} context - { recipe, lastKnownPrice, timeoutMs, fetchHtmlImpl }
 * @returns {Promise<{data: object|null, skipped: string|null, antiBotSuspected: boolean, durationMs: number}>}
 */
async function runTier0(url, { recipe, lastKnownPrice, timeoutMs, fetchHtmlImpl = fetchHtml }) {
	const fetched = await fetchHtmlImpl(url, { timeoutMs });

	if (!fetched.ok) {
		// Lo status fa la differenza fra «mi ha risposto 403» e «non ha risposto»,
		// e sono due indagini diverse: la prima riguarda l'anti-bot, la seconda
		// la rete. Senza, restano indistinguibili nella risposta.
		const skipped = fetched.status ? `${fetched.reason}_${fetched.status}` : fetched.reason;
		console.log(`[Scraper] Tier 0 non applicabile (${skipped}) in ${fetched.durationMs}ms`);
		return {
			data: null,
			skipped,
			antiBotSuspected: Boolean(fetched.antiBotSuspected),
			durationMs: fetched.durationMs,
			evidence: { htmlBytes: null, pageTitle: null, httpStatus: fetched.status ?? null },
		};
	}

	// Una pagina di sfida torna con status 200 e si interpreta senza errori:
	// semplicemente non contiene nulla. Senza questo controllo il motore la
	// scambia per una pagina prodotto priva di prezzo, e l'utente si sente dire
	// che la SUA pagina non ha un prezzo mentre il problema e' che il sito non
	// ce l'ha mai mostrata.
	const challenge = detectInHtml(fetched.html);
	if (challenge.detected) {
		console.warn(`[Scraper] Tier 0: pagina di sfida ${challenge.type} ("${challenge.title}"), ${challenge.bytes} byte`);
		return {
			data: null,
			skipped: `sfida_${challenge.type.toLowerCase()}`,
			antiBotSuspected: true,
			durationMs: fetched.durationMs,
			evidence: { htmlBytes: challenge.bytes, pageTitle: challenge.title, indicators: challenge.indicators },
		};
	}

	const data = interpret(fetched.html, {
		url,
		recipe,
		lastKnownPrice,
		antiBotDetected: false,
		fastPathThreshold: FAST_PATH_THRESHOLD,
	});

	const evidence = { htmlBytes: challenge.bytes, pageTitle: challenge.title, indicators: challenge.indicators };

	const inspected = inspectResult(data, challenge);
	if (!inspected.usable) {
		console.warn(`[Scraper] Tier 0: pagina non utilizzabile (${inspected.reason}), ${challenge.bytes} byte ("${challenge.title}")`);
		return {
			data: null,
			skipped: inspected.reason,
			antiBotSuspected: false,
			durationMs: fetched.durationMs,
			evidence,
		};
	}

	console.log(`[Scraper] Tier 0: confidenza ${data.confidence} in ${fetched.durationMs}ms (${challenge.bytes} byte)`);

	return { data, skipped: null, antiBotSuspected: false, durationMs: fetched.durationMs, evidence };
}

/**
 * Tier 1: la pagina con Chromium, un solo tentativo.
 *
 * @param {string} url
 * @param {object} context
 * @returns {Promise<object>} risultato interpretato
 */
async function runTier1(url, { recipe, lastKnownPrice, attempt, deadline }) {
	let browser = null;
	const proxy = proxyManager.hasProxies() ? proxyManager.getRandomProxy() : null;

	try {
		// Get User-Agent for this request
		const userAgent = attempt === 0
			? userAgentManager.getUserAgentForUrl(url)
			: userAgentManager.getNextUserAgent(); // Use different UA on retry

		console.log(`[Scraper] Attempt ${attempt + 1}/${MAX_RETRIES} for ${url}`);
		console.log(`[Scraper] Using User-Agent: ${userAgent.substring(0, 50)}...`);
		if (proxy) {
			console.log(`[Scraper] Using proxy: ${proxy.server}`);
		}

		// L'avvio di Chromium non e' istantaneo e va scontato dal budget: prima
		// il timeout di navigazione veniva calcolato PRIMA di arrivare qui, come
		// se l'avvio fosse gratuito, e il risultato era che la chiamata sforava
		// il proprio budget di quanto era costato l'avvio - in produzione 10808ms
		// su 9000 concessi - e la navigazione partiva gia' in ritardo.
		const launchedAt = Date.now();
		browser = await createBrowser(proxy);
		const browserStartMs = Date.now() - launchedAt;
		observedBrowserStartMs = browserStartMs;

		const navigationTimeoutMs = deadline - Date.now() - RESPONSE_RESERVE_MS;
		console.log(`[Scraper] Browser avviato in ${browserStartMs}ms, restano ${navigationTimeoutMs}ms per navigare`);

		if (navigationTimeoutMs < NAVIGATION_MIN_MS) {
			// Fermarsi qui e dire quanto serviva vale piu' che spendere il
			// residuo in una navigazione che si tronchera' comunque.
			const needed = browserStartMs + NAVIGATION_MIN_MS + RESPONSE_RESERVE_MS + TIER0_TIMEOUT_MS;
			const error = new Error(`STARTUP_ATE_BUDGET:avvio ${browserStartMs}ms`);
			error.evidence = {
				browserStartMs,
				navigationTimeoutMs,
				suggestedBudgetMs: Math.ceil(needed / 1000) * 1000,
			};
			throw error;
		}

		const page = await browser.newPage();
		await page.setViewport({ width: 1920, height: 1080 });

		// Authenticate proxy if needed
		if (proxy) {
			await proxyManager.authenticateProxy(page, proxy);
		}

		// Set rotating User-Agent
		await page.setUserAgent(userAgent);
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Cache-Control': 'no-cache',
			'Pragma': 'no-cache',
		});

		// Optimize performance by blocking unnecessary resources
		await page.setRequestInterception(true);
		page.on('request', (req) => {
			const resourceType = req.resourceType();
			if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
				req.abort();
			} else {
				req.continue();
			}
		});

		// Domain specific cookies
		const domain = new URL(url).hostname;
		await page.setCookie({
			name: 'session-id',
			value: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
			domain: domain
		});

		// Navigate with timeout handling. Il timeout e' quello che resta del
		// budget, non un valore fisso: un'attesa di trenta secondi dentro una
		// function che ne vive dieci non e' un'attesa, e' un 504.
		let navigationTimedOut = false;
		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: navigationTimeoutMs,
			});
		} catch (navError) {
			if (navError.name !== 'TimeoutError') throw navError;
			navigationTimedOut = true;
			console.warn(`[Scraper] Navigation timeout for ${url} dopo ${navigationTimeoutMs}ms, provo con quel che c'e'`);
		}

		// Enhanced CAPTCHA detection
		const captchaResult = await captchaDetector.detect(page);
		if (captchaResult.detected) {
			console.warn(`[Scraper] CAPTCHA detected (${captchaResult.type}), confidence: ${captchaResult.confidence}%`);

			// Mark proxy as potentially blocked
			if (proxy) {
				proxyManager.markCurrentAsFailed();
			}

			// Throw error to trigger retry with different UA/proxy
			if (attempt < MAX_RETRIES - 1) {
				throw challengeError(captchaResult.type, {
					browserStartMs,
					challengeConfidence: captchaResult.confidence,
					pageTitle: await page.title().catch(() => null),
				});
			}
		}

		// Interpretazione: nessuno store ha codice dedicato. Il browser serve
		// solo a OTTENERE l'HTML; a leggerlo e' la pipeline generica, guidata
		// dalla ricetta del dominio quando ce n'e' una.
		const html = await page.content();

		// La stessa ispezione del tier 0, che qui mancava. Quando la navigazione
		// va in timeout, page.content() restituisce comunque un documento: il
		// guscio vuoto che il browser aveva allora. Interpretarlo produce zero
		// candidati, e senza questo controllo quel nulla diventava la risposta
		// «questa pagina non ha un prezzo» - un'affermazione su una pagina che
		// non abbiamo mai visto.
		const inspection = detectInHtml(html);
		if (inspection.detected) {
			console.warn(`[Scraper] Tier 1: pagina di sfida ${inspection.type} ("${inspection.title}"), ${inspection.bytes} byte`);
			throw challengeError(inspection.type, {
				browserStartMs,
				htmlBytes: inspection.bytes,
				pageTitle: inspection.title,
				challengeIndicators: inspection.indicators,
				navigationTimedOut,
			});
		}

		const data = interpret(html, {
			url,
			recipe,
			lastKnownPrice,
			antiBotDetected: captchaResult.detected,
			fastPathThreshold: FAST_PATH_THRESHOLD,
		});

		if (!data.title) data.title = await page.title();

		const inspected = inspectResult(data, inspection);
		if (!inspected.usable) {
			// Ritentabile: con un altro tentativo la navigazione potrebbe
			// arrivare in fondo. Se il budget non lo consente, il messaggio
			// arriva comunque a destinazione e dice cosa e' successo.
			const cause = navigationTimedOut ? 'navigazione_troncata' : inspected.reason;
			console.warn(`[Scraper] Tier 1: pagina non utilizzabile (${cause}), ${inspection.bytes} byte ("${inspection.title}")`);
			const error = new Error(`EMPTY_PAGE:${cause}`);
			error.evidence = {
				htmlBytes: inspection.bytes,
				pageTitle: inspection.title,
				navigationTimedOut,
				navigationTimeoutMs,
				browserStartMs,
				// Quanto sarebbe servito per non troncare: un numero osservato,
				// non una stima, ed e' cio' che si mette in configurazione.
				suggestedBudgetMs: navigationTimedOut
					? Math.ceil((TIER0_TIMEOUT_MS + browserStartMs + navigationTimeoutMs * 2 + RESPONSE_RESERVE_MS) / 1000) * 1000
					: null,
			};
			throw error;
		}

		data.captchaDetected = captchaResult.detected;
		data.proxyUsed = !!proxy;
		data.userAgent = userAgent;
		data.evidence = {
			htmlBytes: inspection.bytes,
			pageTitle: inspection.title,
			navigationTimedOut,
			browserStartMs,
		};

		await browser.close();
		return data;

	} catch (error) {
		if (browser) {
			try {
				await browser.close();
			} catch (e) {
				// Ignore close errors
			}
		}
		if (proxy && !error.message.includes('CAPTCHA_DETECTED')) {
			// Un errore di rete su un proxy e' un'informazione sul proxy.
			if (error.message.includes('net::ERR_')) proxyManager.markCurrentAsFailed();
		}
		throw error;
	}
}

/**
 * L'errore di una sfida, con le prove attaccate.
 *
 * Prima si lanciava un `new Error('CAPTCHA_DETECTED:...')` nudo, e la
 * diagnostica che arrivava all'utente era priva di tutto cio' che serviva a
 * capire: quale sfida, quanto grande la pagina, che titolo, quanto era costato
 * avviare il browser. Tutti campi che a quel punto erano gia' stati misurati e
 * che si perdevano nel lancio.
 *
 * @param {string} type - il fornitore riconosciuto
 * @param {object} evidence
 */
function challengeError(type, evidence) {
	const error = new Error(`CAPTCHA_DETECTED:${type}`);
	error.evidence = { challengeType: type, ...evidence };
	return error;
}

/** L'errore giustifica un altro tentativo con browser? */
function isRetryable(error) {
	return (
		error.message.includes('CAPTCHA_DETECTED') ||
		error.message.includes('EMPTY_PAGE') ||
		error.message.includes('STARTUP_ATE_BUDGET') ||
		error.message.includes('net::ERR_') ||
		error.message.includes('Protocol error') ||
		error.message.includes('Navigation timeout') ||
		error.name === 'TimeoutError'
	);
}

/**
 * Si puo' saltare la GET e andare diritti al browser?
 *
 * Funzione pura perche' la decisione va potuta verificare senza avviare
 * Chromium: la prima versione viveva dentro il ciclo e l'unico modo di
 * provarla era eseguirla, il che rendeva il test lento e, soprattutto,
 * dipendente da cose che col merito della decisione non c'entravano.
 *
 * @param {object} args
 * @param {object|null} args.recipe
 * @param {boolean} args.allowBrowser
 * @param {number} args.remainingMs
 * @returns {boolean}
 */
function shouldSkipTier0({ recipe, allowBrowser, remainingMs }) {
	if (recipe?.transport !== 'browser') return false;
	// Il transport e' un'indicazione di costo, non un divieto: si salta la GET
	// solo se al browser ci si arriva davvero.
	return allowBrowser && remainingMs >= browserBudgetNeeded();
}

/**
 * Scarica e interpreta una pagina prodotto.
 *
 * @param {string} url
 * @param {object|number} [options] - un numero e' la vecchia firma (attempt)
 * @param {object|null} [options.recipe] - ricetta attiva del dominio
 * @param {number|null} [options.lastKnownPrice] - premia la coerenza storica
 * @param {number} [options.budgetMs] - tempo totale concesso alla chiamata
 * @param {boolean} [options.allowBrowser=true] - false per restare al tier 0
 * @param {boolean} [options.allowHttp] - false per saltare il tier 0
 * @param {function} [options.fetchHtmlImpl] - iniettabile per i test
 * @returns {Promise<Object>}
 */
async function scrapeProduct(url, options = {}) {
	// Compatibilita': la firma precedente era scrapeProduct(url, attempt).
	const normalized = typeof options === 'number' ? { attempt: options } : (options || {});
	const {
		recipe = null,
		lastKnownPrice = null,
		budgetMs = DEFAULT_BUDGET_MS,
		allowBrowser = true,
		allowHttp = TIER0_ENABLED,
		fetchHtmlImpl = fetchHtml,
	} = normalized;

	const startedAt = Date.now();
	const deadline = startedAt + budgetMs;
	const remaining = () => deadline - Date.now();

	const context = { recipe, lastKnownPrice };

	/** Il miglior risultato ottenuto finora, da restituire se il budget finisce. */
	let best = null;
	let tier0Skipped = null;
	let antiBotSuspected = false;
	let evidence = null;
	// Il tier a cui si e' effettivamente arrivati. Va tracciato mentre accade:
	// dedurlo a valle dai campi dell'errore ha gia' prodotto una diagnostica
	// che dichiarava «tier 0» su tentativi in cui il browser era partito.
	let tierReached = 0;

	// --- Tier 0 ---
	//
	// La ricetta del dominio dice gia' con quale trasporto quel sito si legge.
	// Su un dominio che rifiuta le richieste senza browser la GET e' tempo
	// tolto al browser - settecento millisecondi per riprendersi lo stesso 403
	// di ogni volta - e il campo esisteva apposta.
	//
	// Ma saltarla ha senso SOLO se al browser ci si arriva davvero. La prima
	// versione di questo controllo guardava `allowBrowser`, che dice se il
	// browser e' permesso, non se c'e' il tempo di avviarlo: su un dominio con
	// transport 'browser' e un budget gia' eroso dal preambolo il risultato era
	// zero tentativi, ne' GET ne' browser, e un errore in zero millisecondi che
	// dava la colpa alla lentezza di un sito mai contattato.
	//
	// Il transport resta cio' che e' sempre stato: un'indicazione di costo, non
	// un divieto. Se il browser non e' alla portata, una lettura incerta vale
	// piu' di nessuna lettura.
	const skipTier0 = shouldSkipTier0({ recipe, allowBrowser, remainingMs: remaining() });
	const recipeWantsBrowser = recipe?.transport === 'browser';

	if (skipTier0) {
		console.log('[Scraper] La ricetta del dominio chiede il browser: salto il tier 0');
		tier0Skipped = 'ricetta_richiede_browser';
	} else if (recipeWantsBrowser) {
		console.log(`[Scraper] La ricetta chiede il browser ma non e' alla portata (${remaining()}ms): provo comunque la GET`);
	}

	if (allowHttp && !skipTier0) {
		const timeoutMs = Math.min(TIER0_TIMEOUT_MS, Math.max(remaining(), 0));
		if (timeoutMs > 0) {
			try {
				const tier0 = await runTier0(url, { ...context, timeoutMs, fetchHtmlImpl });
				tier0Skipped = tier0.skipped;
				antiBotSuspected = tier0.antiBotSuspected;
				evidence = tier0.evidence || null;

				if (tier0.data) {
					best = { data: tier0.data, tier: 0 };
					// Abbastanza affidabile: il browser non serve, ed e' il caso
					// normale per ogni pagina con dati strutturati.
					if (tier0.data.confidence >= TIER0_THRESHOLD && tier0.data.priceValue !== null) {
						return withDebug(tier0.data, { url, tier: 0, attempt: 1, startedAt, tier0Skipped: null, evidence });
					}
					console.log(`[Scraper] Tier 0 sotto soglia (${tier0.data.confidence} < ${TIER0_THRESHOLD}): salgo al browser`);
				}
			} catch (error) {
				// Il tier 0 non deve mai far fallire la chiamata: al massimo non
				// produce nulla e si sale.
				console.warn(`[Scraper] Tier 0 fallito: ${error.message}`);
				tier0Skipped = 'errore_interno';
			}
		}
	}

	// --- Tier 1 ---
	if (!allowBrowser) {
		return finish(best, { url, startedAt, tierReached, tier0Skipped, antiBotSuspected, evidence, reason: 'browser_non_consentito' });
	}

	let lastError = null;
	let browserAttempts = 0;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		if (remaining() < browserBudgetNeeded()) {
			console.warn(`[Scraper] Budget insufficiente per il browser (${remaining()}ms < ${browserBudgetNeeded()}ms)`);
			// «Budget esaurito» dopo un tentativo e «budget insufficiente per
			// iniziarne uno» sono due cose diverse, e solo la seconda merita di
			// essere raccontata come un problema di configurazione: nel primo
			// caso il sito e' stato contattato, nel secondo no.
			const reason = browserAttempts === 0 && best === null ? 'budget_insufficiente' : 'budget_esaurito';
			return finish(best, { url, startedAt, tierReached, tier0Skipped, antiBotSuspected, evidence, reason, lastError });
		}

		try {
			tierReached = 1;
			browserAttempts++;
			// Si passa la scadenza, non un timeout: quanto tempo resti davvero
			// alla navigazione si sa solo dopo aver avviato il browser.
			const data = await runTier1(url, { ...context, attempt, deadline });
			return withDebug(data, { url, tier: 1, attempt: attempt + 1, startedAt, tier0Skipped, evidence });
		} catch (error) {
			lastError = error;
			// Le prove raccolte dal browser sono piu' precise di quelle del tier
			// 0: dicono cosa ha visto chi e' arrivato piu' avanti.
			if (error.evidence) evidence = { ...evidence, ...error.evidence };
			console.error(`[Scraper] Error on attempt ${attempt + 1}:`, error.message);

			if (!isRetryable(error) || attempt >= MAX_RETRIES - 1) break;

			const delay = retryDelay(error, attempt);
			if (remaining() - delay < browserBudgetNeeded()) {
				console.warn(`[Scraper] Nessun tempo per un altro tentativo (${remaining()}ms): mi fermo qui`);
				break;
			}

			console.log(`[Scraper] Retrying in ${delay}ms con un altro User-Agent...`);
			await sleep(delay);
		}
	}

	return finish(best, {
		url, startedAt, tierReached, tier0Skipped, antiBotSuspected, evidence,
		reason: describeFailure(lastError),
		lastError,
	});
}

/**
 * Il motivo del fallimento, nei termini di chi dovra' agire.
 *
 * «browser_fallito» non aiuta nessuno: la differenza fra una navigazione che
 * non e' arrivata in fondo - si alza il budget - e un sito che serve una sfida
 * - il budget non c'entra - e' tutta l'informazione utile.
 */
function describeFailure(error) {
	if (!error) return 'browser_fallito';
	if (error.message.includes('STARTUP_ATE_BUDGET')) return 'budget_speso_nell_avvio';
	if (error.message.includes('EMPTY_PAGE:')) return error.message.split('EMPTY_PAGE:')[1].split(':')[0];
	if (error.message.includes('CAPTCHA_DETECTED')) return 'pagina_di_sfida';
	if (error.name === 'TimeoutError' || error.message.includes('Navigation timeout')) return 'navigazione_troncata';
	return 'browser_fallito';
}

/**
 * Conclude quando il tier 1 non ha prodotto nulla.
 *
 * Se il tier 0 aveva un risultato lo si restituisce, anche a bassa confidenza:
 * a decidere se e' abbastanza e' chi chiama, che conosce le sue soglie. Se non
 * c'e' nulla si lancia, perche' un risultato vuoto sarebbe indistinguibile da
 * una pagina senza prezzo.
 */
function finish(best, { url, startedAt, tierReached = 0, tier0Skipped, antiBotSuspected, evidence, reason, lastError }) {
	if (best) {
		return withDebug(best.data, { url, tier: best.tier, attempt: 1, startedAt, tier0Skipped, evidence, degraded: reason });
	}

	const detail = lastError ? `: ${lastError.message}` : '';
	const error = new Error(`${BUDGET_EXCEEDED}${detail}`);
	error.code = BUDGET_EXCEEDED;
	error.reason = reason;
	error.tier = tierReached;
	error.antiBotSuspected = antiBotSuspected;
	error.tier0Skipped = tier0Skipped;
	// Anche un tentativo fallito ha una durata, ed e' il numero da cui si
	// capisce se il budget e' bastato: ometterlo dagli errori significava
	// perderlo esattamente dove serviva.
	error.totalMs = Date.now() - startedAt;
	error.evidence = { ...(evidence || {}), ...(lastError?.evidence || {}) };
	throw error;
}

/** Attacca la diagnostica al risultato, nella forma che finisce in scrape_runs. */
function withDebug(data, { url, tier, attempt, startedAt, tier0Skipped, evidence = null, degraded = null }) {
	// Le prove del tier che ha davvero prodotto il risultato hanno la
	// precedenza su quelle raccolte prima di arrivarci.
	const proof = { ...(evidence || {}), ...(data.evidence || {}) };

	data.debug = {
		url,
		tier,
		usedBrowser: tier === 1,
		source: data.fields?.price?.source ?? null,
		confidence: data.confidence,
		usedFastPath: data.usedFastPath,
		recipeId: data.recipeId,
		foundPrice: data.price !== null,
		attempt,
		tier0Skipped,
		degraded,
		totalMs: Date.now() - startedAt,
		htmlBytes: proof.htmlBytes ?? null,
		pageTitle: proof.pageTitle || null,
		httpStatus: proof.httpStatus ?? null,
		navigationTimedOut: proof.navigationTimedOut ?? null,
		// Chi ha prodotto candidati e chi no: e' la prima cosa da guardare
		// quando la confidenza e' bassa e non si sa perche'.
		extractors: (data.extractorsRan || [])
			.map((e) => `${e.name}:${e.candidates}${e.error ? '!' : ''}`)
			.join(' '),
		userAgent: data.userAgent ? data.userAgent.substring(0, 50) : null,
		proxyUsed: Boolean(data.proxyUsed),
		captchaDetected: Boolean(data.captchaDetected),
	};

	delete data.userAgent;
	delete data.proxyUsed;
	delete data.captchaDetected;
	delete data.evidence;

	return data;
}

/**
 * Get scraper stats
 * @returns {Object}
 */
function getScraperStats() {
	return {
		captcha: captchaDetector.getStats(),
		proxy: proxyManager.getStats(),
		userAgentCount: userAgentManager.getAllUserAgents().length,
		tier0: { enabled: TIER0_ENABLED, threshold: TIER0_THRESHOLD, timeoutMs: TIER0_TIMEOUT_MS },
		budgetMs: DEFAULT_BUDGET_MS,
		browserReachable: browserReachability(),
	};
}

module.exports = {
	scrapeProduct,
	getScraperStats,
	browserReachable,
	browserReachability,
	browserBudgetNeeded,
	shouldSkipTier0,
	retryDelay,
	inspectResult,
	BUDGET_EXCEEDED,
	DEFAULT_BUDGET_MS,
};
