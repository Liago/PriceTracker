/**
 * Normalizzazione della valuta a codice ISO-4217.
 *
 * Oggi la valuta e' 'EUR' cablato ovunque nel motore. Con l'apertura a
 * qualunque shop diventa un dato da leggere, e leggerlo male e' peggio che non
 * leggerlo: un prezzo in sterline salvato come euro produce una variazione
 * inventata nella storia prezzi.
 */

// Simboli univoci: una sola valuta possibile.
const UNAMBIGUOUS_SYMBOLS = Object.freeze({
	'€': 'EUR',
	'£': 'GBP',
	'¥': 'JPY',
	'₹': 'INR',
	'₽': 'RUB',
	'₺': 'TRY',
	'₩': 'KRW',
	'₪': 'ILS',
	'zł': 'PLN',
	'Kč': 'CZK',
	'Ft': 'HUF',
	'lei': 'RON',
});

// Simboli ambigui: la valuta dipende dal paese del sito.
const AMBIGUOUS_SYMBOLS = Object.freeze({
	'$': { default: 'USD', byTld: { ca: 'CAD', au: 'AUD', nz: 'NZD', sg: 'SGD', mx: 'MXN', ar: 'ARS', cl: 'CLP', hk: 'HKD' } },
	'kr': { default: 'SEK', byTld: { no: 'NOK', dk: 'DKK', se: 'SEK', is: 'ISK' } },
});

// Codici accettati senza ulteriori verifiche.
const KNOWN_CODES = new Set([
	'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN',
	'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'TRY', 'RUB', 'UAH', 'CAD', 'AUD',
	'NZD', 'SGD', 'HKD', 'INR', 'BRL', 'MXN', 'ARS', 'CLP', 'ZAR', 'KRW',
	'ILS', 'AED', 'SAR', 'ISK', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'TWD',
]);

const DEFAULT_CURRENCY = 'EUR';

/**
 * Ricava il TLD da un hostname o da un URL.
 * @param {string} [source]
 * @returns {string|null} TLD in minuscolo, senza punto
 */
function tldOf(source) {
	if (!source) return null;
	let hostname = String(source);
	if (hostname.includes('://')) {
		try {
			hostname = new URL(hostname).hostname;
		} catch (e) {
			return null;
		}
	}
	hostname = hostname.split('/')[0].split(':')[0];
	const parts = hostname.split('.').filter(Boolean);
	if (parts.length < 2) return null;
	// co.uk, com.au: il TLD di paese e' l'ultimo pezzo.
	return parts[parts.length - 1].toLowerCase();
}

/**
 * Normalizza una valuta espressa come codice o simbolo.
 *
 * @param {string|null|undefined} input - 'EUR', 'eur', '€', '729,00 €', ...
 * @param {object} [context]
 * @param {string} [context.url] - URL o hostname, per sciogliere $ e kr
 * @param {string|null} [context.fallback='EUR'] - valore se non determinabile
 * @returns {{code: string|null, ambiguous: boolean, source: string}}
 *   source: 'code' | 'symbol' | 'symbol_tld' | 'fallback' | 'none'
 */
function normalizeCurrencyDetailed(input, context = {}) {
	const { url, fallback = DEFAULT_CURRENCY } = context;
	const asFallback = () => ({
		code: fallback,
		ambiguous: false,
		source: fallback ? 'fallback' : 'none',
	});

	if (input === null || input === undefined || String(input).trim() === '') {
		return asFallback();
	}

	const text = String(input).trim();

	// Codice ISO esplicito, anche dentro una stringa piu' lunga.
	const codeMatch = text.toUpperCase().match(/\b([A-Z]{3})\b/);
	if (codeMatch && KNOWN_CODES.has(codeMatch[1])) {
		return { code: codeMatch[1], ambiguous: false, source: 'code' };
	}

	for (const [symbol, code] of Object.entries(UNAMBIGUOUS_SYMBOLS)) {
		if (text.includes(symbol)) {
			return { code, ambiguous: false, source: 'symbol' };
		}
	}

	for (const [symbol, config] of Object.entries(AMBIGUOUS_SYMBOLS)) {
		if (!text.includes(symbol)) continue;
		const tld = tldOf(url);
		if (tld && config.byTld[tld]) {
			return { code: config.byTld[tld], ambiguous: false, source: 'symbol_tld' };
		}
		// Non risolvibile: si restituisce il default del simbolo, ma marcato
		// ambiguo perche' chi valuta la confidenza possa penalizzarlo.
		return { code: config.default, ambiguous: true, source: 'symbol' };
	}

	return asFallback();
}

/**
 * @returns {string|null} il codice ISO-4217, oppure il fallback
 */
function normalizeCurrency(input, context) {
	return normalizeCurrencyDetailed(input, context).code;
}

module.exports = {
	normalizeCurrency,
	normalizeCurrencyDetailed,
	tldOf,
	KNOWN_CODES,
	DEFAULT_CURRENCY,
};
