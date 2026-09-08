/**
 * Tier 0: ottenere l'HTML senza browser.
 *
 * E' il difetto D12 della checklist di staging, e in produzione non e' un
 * risparmio ma una precondizione. Una function sincrona di Netlify ha un
 * budget di dieci secondi; avviare Chromium ne costa da solo diversi, e la
 * navigazione ha un timeout di trenta. L'aggiunta di un prodotto non poteva
 * che finire in 504: il proxy chiudeva la connessione prima che il motore
 * avesse un risultato, e all'utente arrivava una pagina di errore HTML al
 * posto di una risposta.
 *
 * L'architettura era gia' pronta: la pipeline lavora su una stringa HTML e non
 * sul `page` di Puppeteer, quindi il browser serviva soltanto a ottenerla. Per
 * gli shop che espongono JSON-LD, microdata o Open Graph - cioe' quelli delle
 * ricette seminate, BackMarket compreso - una GET basta e costa meno di un
 * secondo.
 *
 * Il browser resta, come secondo tier, per le pagine che il prezzo lo
 * costruiscono in JavaScript.
 *
 * Sicurezza. Questa e' la prima volta che il server fa una richiesta HTTP a un
 * URL scelto dall'utente senza passare per il browser, quindi la protezione da
 * SSRF va rifatta qui e non ereditata: si seguono i redirect a mano e ogni
 * salto viene rivalidato con checkUrl, esattamente per il motivo spiegato in
 * policy/urlPolicy.js - un dominio pubblico puo' reindirizzare a un indirizzo
 * interno. La risposta viene letta a blocchi e troncata: un body senza fine
 * esaurirebbe la memoria della function.
 */

const { checkUrl, MAX_REDIRECTS, MAX_RESPONSE_BYTES } = require('./policy/urlPolicy');
const { userAgentManager } = require('../utils/userAgentManager');

/** Oltre questo tempo la GET non vale piu' la pena: meglio lasciare spazio al browser. */
const DEFAULT_TIMEOUT_MS = 8000;

/** Motivi per cui il tier 0 rinuncia. Nessuno di questi e' un errore fatale. */
const SKIP = Object.freeze({
	BLOCKED: 'bloccato_dal_sito',      // 403/429: c'e' un anti-bot, serve il browser
	HTTP_ERROR: 'risposta_non_valida', // altri status fuori dal 2xx
	NOT_HTML: 'non_html',
	TOO_LARGE: 'risposta_troppo_grande',
	REDIRECT_LOOP: 'troppi_redirect',
	POLICY: 'url_non_ammesso',
	TIMEOUT: 'timeout',
	NETWORK: 'errore_di_rete',
});

/** Status che dicono "sei un bot": vale la pena riprovare con Chromium. */
const ANTI_BOT_STATUSES = new Set([401, 403, 405, 406, 429, 503]);

/**
 * Header di una richiesta che somiglia a un browser.
 *
 * Non e' mimetismo per aggirare qualcuno: e' che molti shop servono una pagina
 * diversa - o nessuna - a chi non manda l'insieme di header che un browser
 * manda sempre. La prima versione aveva solo User-Agent, Accept e
 * Accept-Language, e in produzione si e' presa un blocco: mancava tutto il
 * gruppo Sec-Fetch, che ogni Chrome invia su ogni navigazione e la cui assenza
 * e' un segnale piu' forte di uno User-Agent qualunque.
 *
 * Gli hint sec-ch-ua si mandano solo con uno User-Agent Chromium, perche' un
 * Firefox che li dichiarasse sarebbe piu' sospetto di uno che li omette: fra
 * gli header conta la coerenza, non il numero.
 *
 * @param {string} url
 * @returns {object}
 */
function browserHeaders(url) {
	const userAgent = userAgentManager.getUserAgentForUrl(url);
	const chromeVersion = /Firefox/.test(userAgent) ? null : /Chrome\/(\d+)/.exec(userAgent);
	const isEdge = /Edg\//.test(userAgent);

	return {
		'User-Agent': userAgent,
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
		// Non si dichiara "br": la decompressione Brotli non e' garantita su
		// ogni runtime, e una risposta compressa che non sappiamo aprire e'
		// peggio di una non compressa.
		'Accept-Encoding': 'gzip, deflate',
		'Upgrade-Insecure-Requests': '1',
		// Il gruppo che identifica una navigazione: documento di primo livello,
		// aperto dall'utente, non una sottorisorsa caricata da uno script.
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		...(chromeVersion ? {
			'sec-ch-ua': isEdge
				? `"Microsoft Edge";v="${chromeVersion[1]}", "Chromium";v="${chromeVersion[1]}", "Not?A_Brand";v="24"`
				: `"Chromium";v="${chromeVersion[1]}", "Google Chrome";v="${chromeVersion[1]}", "Not?A_Brand";v="24"`,
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': /Macintosh/.test(userAgent) ? '"macOS"' : '"Windows"',
		} : {}),
	};
}

/**
 * Legge il body a blocchi, fermandosi al limite.
 *
 * Non si usa response.text(): quello scarica tutto prima di poter decidere, ed
 * e' esattamente cio' che si vuole evitare su una risposta arbitraria.
 *
 * @param {Response} response
 * @returns {Promise<{buffer: Buffer, truncated: boolean}>}
 */
async function readCapped(response) {
	if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };

	const chunks = [];
	let total = 0;

	for await (const chunk of response.body) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;

		if (total > MAX_RESPONSE_BYTES) {
			chunks.push(buf.subarray(0, buf.length - (total - MAX_RESPONSE_BYTES)));
			return { buffer: Buffer.concat(chunks), truncated: true };
		}

		chunks.push(buf);
	}

	return { buffer: Buffer.concat(chunks), truncated: false };
}

/**
 * Decodifica il body rispettando il charset dichiarato.
 *
 * Diversi shop italiani servono ancora ISO-8859-1: decodificarli come UTF-8
 * rovina gli accenti nel titolo, e un titolo rovinato e' un prodotto che
 * l'utente non riconosce.
 *
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {string}
 */
function decodeHtml(buffer, contentType) {
	const match = /charset=\s*"?([\w-]+)"?/i.exec(contentType || '');
	const charset = (match ? match[1] : 'utf-8').toLowerCase();

	try {
		return new TextDecoder(charset).decode(buffer);
	} catch (e) {
		return buffer.toString('utf8');
	}
}

/**
 * Scarica l'HTML di una pagina seguendo i redirect a mano.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {function} [options.fetchImpl] - iniettabile per i test
 * @param {function} [options.checkUrlImpl] - iniettabile per i test
 * @returns {Promise<{ok: boolean, html?: string, url?: string, status?: number,
 *   reason?: string, antiBotSuspected?: boolean, durationMs: number}>}
 */
async function fetchHtml(url, options = {}) {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		fetchImpl = fetch,
		checkUrlImpl = checkUrl,
	} = options;

	const startedAt = Date.now();
	const elapsed = () => Date.now() - startedAt;

	let current = url;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		// Ogni salto viene rivalidato: e' il controllo che rende utile tutto il
		// resto della politica sugli URL.
		const policy = await checkUrlImpl(current);
		if (!policy.allowed) {
			return { ok: false, reason: SKIP.POLICY, detail: policy.reason, url: current, durationMs: elapsed() };
		}

		const remaining = timeoutMs - elapsed();
		if (remaining <= 0) return { ok: false, reason: SKIP.TIMEOUT, url: current, durationMs: elapsed() };

		let response;
		try {
			response = await fetchImpl(policy.url, {
				method: 'GET',
				headers: browserHeaders(policy.url),
				redirect: 'manual',
				signal: AbortSignal.timeout(remaining),
			});
		} catch (error) {
			const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
			return {
				ok: false,
				reason: timedOut ? SKIP.TIMEOUT : SKIP.NETWORK,
				detail: error.message,
				url: current,
				durationMs: elapsed(),
			};
		}

		const status = response.status;

		if (status >= 300 && status < 400) {
			const location = response.headers.get('location');
			if (!location) {
				return { ok: false, reason: SKIP.HTTP_ERROR, status, url: current, durationMs: elapsed() };
			}
			// I redirect relativi sono la norma: si risolvono contro l'URL corrente.
			current = new URL(location, policy.url).toString();
			continue;
		}

		if (ANTI_BOT_STATUSES.has(status)) {
			return {
				ok: false,
				reason: SKIP.BLOCKED,
				status,
				antiBotSuspected: true,
				url: current,
				durationMs: elapsed(),
			};
		}

		if (status < 200 || status >= 300) {
			return { ok: false, reason: SKIP.HTTP_ERROR, status, url: current, durationMs: elapsed() };
		}

		const contentType = response.headers.get('content-type') || '';
		if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
			return { ok: false, reason: SKIP.NOT_HTML, status, url: current, durationMs: elapsed() };
		}

		const { buffer, truncated } = await readCapped(response);
		if (truncated) {
			return { ok: false, reason: SKIP.TOO_LARGE, status, url: current, durationMs: elapsed() };
		}

		return {
			ok: true,
			html: decodeHtml(buffer, contentType),
			url: current,
			status,
			durationMs: elapsed(),
		};
	}

	return { ok: false, reason: SKIP.REDIRECT_LOOP, url: current, durationMs: elapsed() };
}

module.exports = { fetchHtml, decodeHtml, readCapped, browserHeaders, SKIP, DEFAULT_TIMEOUT_MS };
