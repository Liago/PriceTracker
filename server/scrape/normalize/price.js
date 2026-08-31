/**
 * Normalizzazione del prezzo: UNICA implementazione del progetto.
 *
 * Sostituisce le tre versioni divergenti che convivevano (difetto D5 del
 * design doc): services/priceTracker.js, client/src/lib/utils.js e il parsing
 * inline dentro BackMarketScraper. Lo stesso prezzo veniva interpretato in
 * modo diverso a seconda del percorso di codice che lo raggiungeva.
 *
 * Differenza di contratto rispetto alle vecchie versioni: qui un input non
 * interpretabile restituisce null, non 0. Zero e' un prezzo, non un errore, e
 * confonderli e' esattamente il modo in cui un fallimento di scraping finiva
 * per sembrare un dato valido.
 */

// Separatori delle migliaia diversi dal punto e dalla virgola: spazi di varia
// natura (FR, ISO) e apostrofi (CH).
const GROUP_SEPARATORS = /[\s    '’ʼ]/g;

const DEFAULT_MAX_VALUE = 10000000;

/** Motivi di rifiuto, utili in diagnostica e nei log di scrape_runs. */
const REASONS = Object.freeze({
	OK: 'ok',
	EMPTY: 'empty',
	NOT_A_PRICE: 'not_a_price',
	PERCENTAGE: 'percentage',
	NEGATIVE: 'negative',
	ZERO: 'zero',
	TOO_LARGE: 'too_large',
	NOT_FINITE: 'not_finite',
});

/**
 * Decide come interpretare punti e virgole in un numero gia' ripulito.
 *
 * Regola: l'ultimo separatore seguito da 1 o 2 cifre e' il separatore
 * decimale. Tre cifre dopo un separatore unico significano migliaia
 * (1.234 = milleduecentotrentaquattro), che e' la convenzione dei prezzi:
 * un prezzo scritto "1.234" non vale un euro e ventitre'.
 *
 * @param {string} digits - solo cifre, punti e virgole
 * @returns {string} numero in formato JS (punto decimale, niente migliaia)
 */
function resolveSeparators(digits) {
	const lastDot = digits.lastIndexOf('.');
	const lastComma = digits.lastIndexOf(',');

	if (lastDot === -1 && lastComma === -1) return digits;

	// Entrambi presenti: l'ultimo dei due e' il decimale, l'altro le migliaia.
	if (lastDot !== -1 && lastComma !== -1) {
		if (lastDot > lastComma) return digits.replace(/,/g, '');
		return digits.replace(/\./g, '').replace(',', '.');
	}

	const separator = lastDot !== -1 ? '.' : ',';
	const position = lastDot !== -1 ? lastDot : lastComma;
	const occurrences = digits.split(separator).length - 1;
	const decimals = digits.length - position - 1;

	// Piu' di un separatore dello stesso tipo: sono tutti migliaia.
	if (occurrences > 1) {
		return digits.split(separator).join('');
	}

	// Separatore unico: 1-2 cifre dopo => decimale, altrimenti migliaia.
	if (decimals === 1 || decimals === 2) {
		return digits.replace(separator, '.');
	}

	return digits.replace(separator, '');
}

/**
 * @param {string|number|null|undefined} input
 * @param {object} [options]
 * @param {number} [options.maxValue=10000000] - tetto di plausibilita'
 * @param {boolean} [options.allowZero=false] - se true, 0 e' un prezzo valido
 * @param {boolean} [options.cents=false] - l'input e' in centesimi interi
 *   (Shopify e altre piattaforme espongono i prezzi cosi')
 * @returns {{value: number|null, reason: string, hadRange: boolean}}
 */
function parsePriceDetailed(input, options = {}) {
	const {
		maxValue = DEFAULT_MAX_VALUE,
		allowZero = false,
		cents = false,
	} = options;

	const fail = (reason) => ({ value: null, reason, hadRange: false });

	if (input === null || input === undefined || input === '') return fail(REASONS.EMPTY);

	let numeric;
	let hadRange = false;

	if (typeof input === 'number') {
		if (!Number.isFinite(input)) return fail(REASONS.NOT_FINITE);
		numeric = input;
	} else {
		const text = String(input);
		if (text.trim() === '') return fail(REASONS.EMPTY);

		// Una percentuale non e' un prezzo: e' quasi sempre uno sconto.
		if (text.includes('%')) return fail(REASONS.PERCENTAGE);

		const cleaned = text.replace(GROUP_SEPARATORS, '');

		// Primo gruppo numerico: se la stringa e' un intervallo ("da 199 a 249")
		// si prende il primo valore e lo si segnala al chiamante.
		const matches = cleaned.match(/\d+(?:[.,]\d+)*/g);
		if (!matches || matches.length === 0) return fail(REASONS.NOT_A_PRICE);
		hadRange = matches.length > 1;

		// Un segno meno immediatamente prima del numero lo rende negativo.
		const firstIndex = cleaned.indexOf(matches[0]);
		const isNegative = /[-−]\s*$/.test(cleaned.slice(0, firstIndex));

		const resolved = resolveSeparators(matches[0]);
		numeric = parseFloat(resolved);
		if (!Number.isFinite(numeric)) return fail(REASONS.NOT_A_PRICE);
		if (isNegative) numeric = -numeric;
	}

	if (cents) numeric = numeric / 100;

	if (numeric < 0) return { value: null, reason: REASONS.NEGATIVE, hadRange };
	if (numeric === 0 && !allowZero) return { value: null, reason: REASONS.ZERO, hadRange };
	if (numeric > maxValue) return { value: null, reason: REASONS.TOO_LARGE, hadRange };

	// I prezzi si esprimono al centesimo. Arrotondare qui evita che
	// l'imprecisione dei float finisca nella colonna numeric(12,2).
	const value = Math.round(numeric * 100) / 100;

	return { value, reason: REASONS.OK, hadRange };
}

/**
 * Variante che restituisce solo il valore.
 * @returns {number|null} null se l'input non e' un prezzo utilizzabile
 */
function parsePrice(input, options) {
	return parsePriceDetailed(input, options).value;
}

module.exports = {
	parsePrice,
	parsePriceDetailed,
	resolveSeparators,
	REASONS,
	DEFAULT_MAX_VALUE,
};
