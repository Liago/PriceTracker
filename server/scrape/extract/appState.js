/**
 * E4 - Stato applicativo incorporato nella pagina.
 *
 * Next.js, Nuxt, Redux, Apollo, GA4 e Shopify lasciano nella pagina lo stato
 * completo del prodotto, spesso piu' ricco e piu' aggiornato del markup.
 *
 * La ricerca e' PER STRUTTURA, non per percorso fisso: cerca oggetti che
 * abbiano una chiave di prezzo e una di valuta vicine, con preferenza per i
 * rami che contengono anche identificatori di prodotto. Un percorso fisso come
 * "props.pageProps.product.price" e' esattamente il tipo di conoscenza
 * cablata che questo refactor elimina - cambia a ogni rilascio dello store.
 */

const { candidate, compact } = require('./candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeCurrency } = require('../normalize/currency');
const { normalizeAvailability } = require('../normalize/availability');
const { parseJsonLoosely } = require('../document');

const PRICE_KEYS = ['price', 'amount', 'value', 'currentprice', 'saleprice', 'finalprice', 'pricevalue', 'unitprice'];
const CURRENCY_KEYS = ['currency', 'currencycode', 'pricecurrency', 'currency_code'];
const IDENTITY_KEYS = ['sku', 'productid', 'variantid', 'gtin', 'ean', 'mpn', 'itemid', 'id'];
const AVAILABILITY_KEYS = ['availability', 'available', 'instock', 'in_stock', 'stockstatus'];
const TITLE_KEYS = ['name', 'title', 'productname', 'displayname'];

// Chiavi che segnalano un prezzo che NON e' quello del prodotto.
const EXCLUDED_KEY_HINTS = ['shipping', 'spedizione', 'tax', 'iva', 'discount', 'sconto', 'saving', 'installment', 'rata', 'monthly', 'compare', 'was', 'old', 'list', 'msrp', 'strike'];

const MAX_DEPTH = 12;
const MAX_NODES = 20000;

/** @returns {boolean} */
function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Normalizza una chiave per il confronto. */
const norm = (key) => String(key).toLowerCase().replace(/[_\-\s]/g, '');

/** Una chiave suggerisce un prezzo che non e' quello del prodotto? */
function isExcludedKey(key) {
	const lower = String(key).toLowerCase();
	return EXCLUDED_KEY_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Sorgenti di stato dentro la pagina.
 * @param {import('../document').ScrapeDocument} doc
 * @returns {Array<{name: string, data: *}>}
 */
function collectStates(doc) {
	const $ = doc.$;
	const states = [];

	const nextData = $('#__NEXT_DATA__').first();
	if (nextData.length > 0) {
		const parsed = parseJsonLoosely(nextData.contents().text());
		if (parsed !== undefined) states.push({ name: '__NEXT_DATA__', data: parsed });
	}

	// Stati assegnati a variabili globali dentro uno <script>.
	const GLOBAL_PATTERNS = [
		['__NUXT__', /window\.__NUXT__\s*=\s*/],
		['__INITIAL_STATE__', /window\.__INITIAL_STATE__\s*=\s*/],
		['__APOLLO_STATE__', /window\.__APOLLO_STATE__\s*=\s*/],
		['__PRELOADED_STATE__', /window\.__PRELOADED_STATE__\s*=\s*/],
		['prestashop', /window\.prestashop\s*=\s*/],
		['__BCData', /window\.__BCData\s*=\s*/],
		['ShopifyAnalytics', /ShopifyAnalytics\.meta\s*=\s*/],
	];

	$('script').each((_, element) => {
		const code = $(element).contents().text();
		if (!code || code.length > 2000000) return;

		for (const [name, pattern] of GLOBAL_PATTERNS) {
			const match = pattern.exec(code);
			if (!match) continue;
			const parsed = parseJsonLoosely(code.slice(match.index + match[0].length));
			if (parsed !== undefined) states.push({ name, data: parsed });
		}

		// dataLayer di GA4: l'evento view_item porta il prezzo che lo store
		// stesso considera corretto, ed e' fra i segnali piu' affidabili.
		if (code.includes('dataLayer')) {
			const match = /dataLayer\s*(?:=|\.push\()\s*/.exec(code);
			if (match) {
				const parsed = parseJsonLoosely(code.slice(match.index + match[0].length));
				if (parsed !== undefined) states.push({ name: 'dataLayer', data: parsed });
			}
		}
	});

	return states;
}

/**
 * Cerca nell'albero gli oggetti che sembrano descrivere un prezzo.
 *
 * @param {*} root
 * @param {string} stateName
 * @returns {Array<{price:*, currency:*, availability:*, title:*, hasIdentity:boolean, path:string}>}
 */
function findPriceObjects(root, stateName) {
	const found = [];
	const seen = new Set();
	let visited = 0;

	const walk = (node, path, depth) => {
		if (visited > MAX_NODES || depth > MAX_DEPTH) return;
		if (!node || typeof node !== 'object') return;
		if (seen.has(node)) return;
		seen.add(node);
		visited++;

		if (Array.isArray(node)) {
			node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
			return;
		}

		const keys = Object.keys(node);
		const byNorm = new Map(keys.map((k) => [norm(k), k]));

		const priceKey = PRICE_KEYS.map((k) => byNorm.get(k)).find((k) => k !== undefined && !isExcludedKey(k));
		const currencyKey = CURRENCY_KEYS.map((k) => byNorm.get(k)).find((k) => k !== undefined);

		// Serve un prezzo scalare accompagnato da una valuta: la coppia e' cio'
		// che distingue un prezzo da un numero qualsiasi.
		if (priceKey !== undefined && currencyKey !== undefined) {
			const priceValue = node[priceKey];
			const currencyValue = node[currencyKey];
			if ((typeof priceValue === 'number' || typeof priceValue === 'string')
				&& typeof currencyValue === 'string') {
				const availabilityKey = AVAILABILITY_KEYS.map((k) => byNorm.get(k)).find((k) => k !== undefined);
				const titleKey = TITLE_KEYS.map((k) => byNorm.get(k)).find((k) => k !== undefined);
				found.push({
					price: priceValue,
					currency: currencyValue,
					availability: availabilityKey !== undefined ? node[availabilityKey] : null,
					title: titleKey !== undefined && typeof node[titleKey] === 'string' ? node[titleKey] : null,
					hasIdentity: IDENTITY_KEYS.some((k) => byNorm.has(k)),
					path: `${stateName}${path}.${priceKey}`,
				});
			}
		}

		for (const key of keys) {
			walk(node[key], `${path}.${key}`, depth + 1);
		}
	};

	walk(root, '', 0);
	return found;
}

/**
 * @param {import('../document').ScrapeDocument} doc
 * @returns {Array} candidati
 */
// Come per il JSON-LD: la ricetta registra che su questo dominio il prezzo
// vive nello stato applicativo, non un percorso per indice - i percorsi
// cambiano a ogni rilascio dello store, ed e' esattamente il motivo per cui
// BackMarketScraper si rompe.
const LOCATOR = Object.freeze({ strategy: 'appstate' });

function extract(doc) {
	const candidates = [];

	for (const state of collectStates(doc)) {
		const matches = findPriceObjects(state.data, state.name);
		if (matches.length === 0) continue;

		// Chi porta anche un identificatore di prodotto viene prima: e' quasi
		// sempre l'oggetto del prodotto e non un frammento di configurazione.
		matches.sort((a, b) => Number(b.hasIdentity) - Number(a.hasIdentity));

		const best = matches[0];
		const value = parsePrice(best.price);
		if (value === null) continue;

		candidates.push(candidate({
			locator: LOCATOR,
			field: 'price', value, raw: best.price, source: 'appstate', path: best.path,
			evidence: `${state.name} -> ${best.price} ${best.currency}`,
			meta: { hasIdentity: best.hasIdentity, stateName: state.name },
		}));

		const currency = normalizeCurrency(best.currency, { url: doc.url, fallback: null });
		if (currency) {
			candidates.push(candidate({
				locator: LOCATOR,
				field: 'currency', value: currency, raw: best.currency,
				source: 'appstate', path: best.path.replace(/\.[^.]+$/, '.currency'),
			}));
		}

		if (best.availability !== null && best.availability !== undefined) {
			candidates.push(candidate({
				locator: LOCATOR,
				field: 'availability', value: normalizeAvailability(best.availability),
				raw: best.availability, source: 'appstate', path: `${state.name}.availability`,
			}));
		}

		if (best.title) {
			candidates.push(candidate({
				locator: LOCATOR,
				field: 'title', value: best.title.trim(), source: 'appstate', path: `${state.name}.name`,
			}));
		}
	}

	return compact(candidates);
}

module.exports = { extract, collectStates, findPriceObjects, name: 'appstate' };
