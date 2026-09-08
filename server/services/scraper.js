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

/** Errore riconoscibile: il budget e' finito prima di un risultato. */
const BUDGET_EXCEEDED = 'SCRAPE_BUDGET_EXCEEDED';

/**
 * Il tier 1 e' raggiungibile con questa configurazione?
 *
 * E' aritmetica, non un'opinione: per avviare Chromium serve che, dopo la GET
 * del tier 0, resti almeno BROWSER_MIN_MS. Se il budget totale non copre la
 * somma, il browser non partira' MAI e ogni pagina che l'HTML statico non
 * risolve finira' come lettura incompleta.
 *
 * Non e' necessariamente un errore - su una function sincrona di Netlify da
 * dieci secondi e' semplicemente la realta', e il tier 0 e' l'unica strada -
 * ma deve essere una scelta consapevole e non una sorpresa da diagnosticare
 * a valle, in produzione, guardando i 503.
 */
function browserReachable() {
	return DEFAULT_BUDGET_MS >= TIER0_TIMEOUT_MS + BROWSER_MIN_MS;
}

if (!browserReachable()) {
	console.warn(
		`[Scraper] Con SCRAPE_REQUEST_BUDGET_MS=${DEFAULT_BUDGET_MS} il browser non parte mai: `
		+ `servirebbero almeno ${TIER0_TIMEOUT_MS + BROWSER_MIN_MS}ms (tier 0 ${TIER0_TIMEOUT_MS} + avvio ${BROWSER_MIN_MS}). `
		+ 'Le pagine che il solo HTML non risolve daranno SCRAPE_INCOMPLETE. '
		+ 'Alza il budget se la piattaforma lo consente, oppure lascia questi controlli al worker.',
	);
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
 * Tier 0: la pagina via GET, interpretata dalla pipeline.
 *
 * @param {string} url
 * @param {object} context - { recipe, lastKnownPrice, timeoutMs, fetchHtmlImpl }
 * @returns {Promise<{data: object|null, skipped: string|null, antiBotSuspected: boolean, durationMs: number}>}
 */
async function runTier0(url, { recipe, lastKnownPrice, timeoutMs, fetchHtmlImpl = fetchHtml }) {
	const fetched = await fetchHtmlImpl(url, { timeoutMs });

	if (!fetched.ok) {
		console.log(`[Scraper] Tier 0 non applicabile (${fetched.reason}) in ${fetched.durationMs}ms`);
		return {
			data: null,
			skipped: fetched.reason,
			antiBotSuspected: Boolean(fetched.antiBotSuspected),
			durationMs: fetched.durationMs,
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

	// Quando si puo' dire che di pagina non ne e' arrivata una - cosa diversa
	// dal giudizio «questa pagina non ha un prezzo», che presuppone di averla
	// vista.
	//
	// Zero candidati da sei estrattori indipendenti basta da solo: su un HTML
	// reale non capita, perche' anche una pagina «chi siamo» produce un titolo.
	//
	// La dimensione invece non basta MAI da sola, ed e' un errore che vale la
	// pena ricordare: le fixture di questo progetto stanno in poco piu' di un
	// kilobyte e si leggono benissimo. Conta solo combinata con l'assenza di
	// qualunque candidato prezzo - una risposta minuscola da cui non esce un
	// numero non e' una scheda prodotto.
	//
	// Non basta nemmeno l'assenza del solo prezzo su una pagina piena: una
	// scheda legittima puo' non averlo - esaurito, prezzo su richiesta - e
	// quella e' un'altra risposta, che spetta a chi chiama.
	const candidates = data.candidates || [];
	const producedNothing = candidates.length === 0;
	const noPrice = !candidates.some((candidate) => candidate.field === 'price');
	const implausiblePage = challenge.reason === 'pagina_troppo_piccola';

	if (producedNothing || (implausiblePage && noPrice)) {
		console.warn(`[Scraper] Tier 0: pagina non utilizzabile, ${challenge.bytes} byte ("${challenge.title}"), ${candidates.length} candidati, nessun prezzo`);
		return {
			data: null,
			skipped: producedNothing ? 'nessun_candidato' : (challenge.reason || 'nessun_candidato'),
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
async function runTier1(url, { recipe, lastKnownPrice, attempt, navigationTimeoutMs }) {
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

		browser = await createBrowser(proxy);
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
		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: navigationTimeoutMs,
			});
		} catch (navError) {
			if (navError.name !== 'TimeoutError') throw navError;
			console.warn(`[Scraper] Navigation timeout for ${url}, proceeding with partial load`);
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
				throw new Error(`CAPTCHA_DETECTED:${captchaResult.type}`);
			}
		}

		// Interpretazione: nessuno store ha codice dedicato. Il browser serve
		// solo a OTTENERE l'HTML; a leggerlo e' la pipeline generica, guidata
		// dalla ricetta del dominio quando ce n'e' una.
		const html = await page.content();
		const data = interpret(html, {
			url,
			recipe,
			lastKnownPrice,
			antiBotDetected: captchaResult.detected,
			fastPathThreshold: FAST_PATH_THRESHOLD,
		});

		if (!data.title) data.title = await page.title();

		data.captchaDetected = captchaResult.detected;
		data.proxyUsed = !!proxy;
		data.userAgent = userAgent;

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

/** L'errore giustifica un altro tentativo con browser? */
function isRetryable(error) {
	return (
		error.message.includes('CAPTCHA_DETECTED') ||
		error.message.includes('net::ERR_') ||
		error.message.includes('Protocol error') ||
		error.message.includes('Navigation timeout') ||
		error.name === 'TimeoutError'
	);
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

	// --- Tier 0 ---
	if (allowHttp) {
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
		return finish(best, { url, startedAt, tier0Skipped, antiBotSuspected, evidence, reason: 'browser_non_consentito' });
	}

	let lastError = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		if (remaining() < BROWSER_MIN_MS) {
			console.warn(`[Scraper] Budget insufficiente per il browser (${remaining()}ms < ${BROWSER_MIN_MS}ms)`);
			return finish(best, { url, startedAt, tier0Skipped, antiBotSuspected, evidence, reason: 'budget_esaurito', lastError });
		}

		try {
			// Alla navigazione si lascia il residuo meno il margine di avvio e
			// chiusura, mai piu' del budget stesso.
			const navigationTimeoutMs = Math.max(remaining() - 3000, 2000);
			const data = await runTier1(url, { ...context, attempt, navigationTimeoutMs });
			return withDebug(data, { url, tier: 1, attempt: attempt + 1, startedAt, tier0Skipped, evidence });
		} catch (error) {
			lastError = error;
			console.error(`[Scraper] Error on attempt ${attempt + 1}:`, error.message);

			if (!isRetryable(error) || attempt >= MAX_RETRIES - 1) break;

			const delay = getBackoffDelay(attempt);
			if (remaining() - delay < BROWSER_MIN_MS) {
				console.warn('[Scraper] Nessun tempo per un altro tentativo: mi fermo qui');
				break;
			}

			console.log(`[Scraper] Retrying in ${Math.round(delay / 1000)}s...`);
			await sleep(delay);
		}
	}

	return finish(best, { url, startedAt, tier0Skipped, antiBotSuspected, evidence, reason: 'browser_fallito', lastError });
}

/**
 * Conclude quando il tier 1 non ha prodotto nulla.
 *
 * Se il tier 0 aveva un risultato lo si restituisce, anche a bassa confidenza:
 * a decidere se e' abbastanza e' chi chiama, che conosce le sue soglie. Se non
 * c'e' nulla si lancia, perche' un risultato vuoto sarebbe indistinguibile da
 * una pagina senza prezzo.
 */
function finish(best, { url, startedAt, tier0Skipped, antiBotSuspected, evidence, reason, lastError }) {
	if (best) {
		return withDebug(best.data, { url, tier: best.tier, attempt: 1, startedAt, tier0Skipped, evidence, degraded: reason });
	}

	const detail = lastError ? `: ${lastError.message}` : '';
	const error = new Error(`${BUDGET_EXCEEDED}${detail}`);
	error.code = BUDGET_EXCEEDED;
	error.reason = reason;
	error.antiBotSuspected = antiBotSuspected;
	error.tier0Skipped = tier0Skipped;
	error.evidence = evidence;
	throw error;
}

/** Attacca la diagnostica al risultato, nella forma che finisce in scrape_runs. */
function withDebug(data, { url, tier, attempt, startedAt, tier0Skipped, evidence = null, degraded = null }) {
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
		htmlBytes: evidence?.htmlBytes ?? null,
		pageTitle: evidence?.pageTitle || null,
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
		browserReachable: browserReachable(),
	};
}

module.exports = {
	scrapeProduct,
	getScraperStats,
	browserReachable,
	BUDGET_EXCEEDED,
	DEFAULT_BUDGET_MS,
};
