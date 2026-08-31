/**
 * Identita' di un'offerta.
 *
 * Un prodotto seguito non e' un URL: e' una variante specifica, venduta da un
 * venditore specifico, in una condizione specifica. La chiave calcolata qui e'
 * cio' che tiene coerente una serie storica - senza, la storia prezzi di un
 * ricondizionato mescola tagli di memoria diversi (difetto D6).
 */

const crypto = require('crypto');

/** Parametri di URL che identificano una variante e vanno conservati. */
const VARIANT_PARAMS = [
	'variant', 'sku', 'color', 'colour', 'size', 'taglia', 'colore',
	'capacity', 'memoria', 'storage', 'model', 'grade', 'condition',
];

/** Parametri di tracciamento, che non identificano nulla del prodotto. */
const TRACKING_PARAM_PATTERNS = [
	/^utm_/i, /^gclid$/i, /^fbclid$/i, /^msclkid$/i, /^mc_/i, /^_ga$/i,
	/^ref$/i, /^referrer$/i, /^source$/i, /^campaign$/i, /^affiliate/i,
	/^tag$/i, /^linkCode$/i, /^ascsubtag$/i, /^th$/i, /^psc$/i,
];

function isTrackingParam(name) {
	return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Ripulisce un URL dai parametri di tracciamento conservando quelli di
 * variante.
 *
 * La distinzione conta: togliere "?variant=456" significherebbe seguire un
 * prodotto diverso da quello che l'utente ha aggiunto.
 *
 * @param {string} url
 * @returns {string|null}
 */
function canonicalizeUrl(url) {
	if (!url) return null;
	let parsed;
	try {
		parsed = new URL(url);
	} catch (e) {
		return null;
	}

	for (const name of [...parsed.searchParams.keys()]) {
		if (isTrackingParam(name)) parsed.searchParams.delete(name);
	}

	parsed.hash = '';
	parsed.searchParams.sort();
	// Normalizza la barra finale, che non cambia la risorsa.
	if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
		parsed.pathname = parsed.pathname.slice(0, -1);
	}
	return parsed.toString();
}

/**
 * Estrae dai parametri di URL quelli che descrivono una variante.
 * @returns {object}
 */
function variantFromUrl(url) {
	if (!url) return {};
	let parsed;
	try {
		parsed = new URL(url);
	} catch (e) {
		return {};
	}

	const variant = {};
	for (const [name, value] of parsed.searchParams) {
		const lower = name.toLowerCase();
		if (VARIANT_PARAMS.includes(lower) || lower.startsWith('dwvar_')) {
			variant[lower] = value;
		}
	}
	return variant;
}

/** Normalizza un valore testuale per la chiave: minuscolo, spazi compattati. */
function normalizeToken(value) {
	if (value === null || value === undefined) return '';
	return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Chiave stabile di un'offerta.
 *
 * Stabile significa che gli stessi attributi producono sempre la stessa
 * chiave, indipendentemente dall'ordine con cui arrivano: e' cio' che permette
 * di ritrovare la stessa offerta al controllo successivo.
 *
 * @param {object} offer
 * @param {object} [offer.variant]
 * @param {string} [offer.seller]
 * @param {string} [offer.condition]
 * @returns {string} 'default' se non c'e' nulla che distingua l'offerta
 */
function offerKey({ variant = {}, seller = null, condition = null } = {}) {
	const parts = [];

	const entries = Object.entries(variant || {})
		.filter(([, value]) => value !== null && value !== undefined && value !== '')
		.map(([key, value]) => [normalizeToken(key), normalizeToken(value)])
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	for (const [key, value] of entries) parts.push(`${key}=${value}`);
	if (seller) parts.push(`seller=${normalizeToken(seller)}`);
	if (condition) parts.push(`condition=${normalizeToken(condition)}`);

	if (parts.length === 0) return 'default';

	return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Costruisce il descrittore di offerta a partire da un risultato di pipeline.
 *
 * @param {object} result - campo `result` di runPipeline
 * @param {string} [url]
 * @returns {{offerKey: string, variant: object, seller: string|null, condition: string|null, gtin: string|null, sku: string|null, url: string|null}}
 */
function describeOffer(result = {}, url = null) {
	const variant = { ...variantFromUrl(url), ...(result.variant || {}) };
	const seller = result.seller || null;
	const condition = result.condition || null;

	return {
		offerKey: offerKey({ variant, seller, condition }),
		variant,
		seller,
		condition,
		gtin: result.gtin || null,
		sku: result.sku || null,
		url: canonicalizeUrl(url),
	};
}

module.exports = {
	offerKey,
	describeOffer,
	canonicalizeUrl,
	variantFromUrl,
	isTrackingParam,
	VARIANT_PARAMS,
};
