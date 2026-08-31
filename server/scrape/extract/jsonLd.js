/**
 * E1 - Estrattore JSON-LD (schema.org).
 *
 * Copre i casi che i tredici scraper attuali ignorano, e che sono la ragione
 * per cui oggi molte pagine perfettamente strutturate finiscono comunque nelle
 * euristiche DOM:
 *
 *  - radice che e' un array di oggetti, non un oggetto
 *  - @graph, usato da WordPress/Yoast e da mezzo web
 *  - Product annidato dentro ItemPage, WebPage o mainEntity
 *  - offers come oggetto singolo oppure come array
 *  - AggregateOffer, dove il prezzo sta in lowPrice/highPrice
 *  - priceSpecification, incluso il prezzo unitario da ESCLUDERE
 *  - hasVariant, per le pagine con varianti
 */

const { candidate, compact } = require('./candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeCurrency } = require('../normalize/currency');
const { normalizeAvailability } = require('../normalize/availability');

/** @param {*} value @returns {Array} */
function asArray(value) {
	if (value === null || value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

/** Confronta @type, che puo' essere stringa o array. */
function hasType(node, ...types) {
	if (!node || typeof node !== 'object') return false;
	const nodeTypes = asArray(node['@type']).map((t) => String(t).toLowerCase());
	return types.some((t) => nodeTypes.includes(t.toLowerCase()));
}

/**
 * Percorre l'albero JSON-LD e restituisce tutti i nodi Product, ovunque siano.
 * @param {Array<object>} blocks
 * @returns {Array<{node: object, path: string}>}
 */
function findProducts(blocks) {
	const found = [];
	const seen = new Set();

	const walk = (node, path, depth) => {
		if (!node || typeof node !== 'object' || depth > 8) return;
		if (seen.has(node)) return;
		seen.add(node);

		if (Array.isArray(node)) {
			node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
			return;
		}

		if (hasType(node, 'Product', 'ProductModel', 'IndividualProduct', 'Vehicle', 'Book')) {
			found.push({ node, path });
		}

		// Contenitori tipici in cui il Product e' annidato.
		for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'about', 'hasVariant']) {
			if (node[key]) walk(node[key], `${path}.${key}`, depth + 1);
		}
	};

	blocks.forEach((block, index) => walk(block, `$[${index}]`, 0));
	return found;
}

/**
 * Estrae il prezzo da un nodo Offer o AggregateOffer.
 * @returns {{value: *, path: string, isRange: boolean}|null}
 */
function priceFromOffer(offer, basePath) {
	if (!offer || typeof offer !== 'object') return null;

	if (hasType(offer, 'AggregateOffer')) {
		// Intervallo: si prende il minimo, segnalandolo.
		const low = offer.lowPrice ?? offer.price;
		if (low !== undefined && low !== null) {
			return { value: low, path: `${basePath}.lowPrice`, isRange: true };
		}
		return null;
	}

	if (offer.price !== undefined && offer.price !== null) {
		return { value: offer.price, path: `${basePath}.price`, isRange: false };
	}

	// priceSpecification: da usare solo se NON e' un prezzo unitario. Un
	// UnitPriceSpecification con referenceQuantity diversa da 1 e' il prezzo
	// al chilo o al litro, non il prezzo del prodotto.
	for (const spec of asArray(offer.priceSpecification)) {
		if (!spec || typeof spec !== 'object') continue;
		const referenceValue = spec.referenceQuantity?.value;
		const isUnitPrice = hasType(spec, 'UnitPriceSpecification')
			&& referenceValue !== undefined
			&& Number(referenceValue) !== 1;
		if (isUnitPrice) continue;
		if (spec.price !== undefined && spec.price !== null) {
			return { value: spec.price, path: `${basePath}.priceSpecification.price`, isRange: false };
		}
	}

	return null;
}

/** Tutte le offerte di un nodo Product, appiattite. */
function offersOf(productNode, basePath) {
	const offers = [];
	asArray(productNode.offers).forEach((offer, index) => {
		offers.push({ offer, path: `${basePath}.offers[${index}]` });
	});
	return offers;
}

/**
 * @param {import('../document').ScrapeDocument} doc
 * @returns {Array} candidati
 */
function extract(doc) {
	const products = findProducts(doc.jsonLdBlocks());
	if (products.length === 0) return [];

	const candidates = [];

	// Il primo Product trovato e' quello della pagina; gli altri sono in genere
	// prodotti correlati o breadcrumb, e vengono ignorati per i campi scalari.
	const { node, path } = products[0];

	if (node.name) {
		candidates.push(candidate({
			field: 'title', value: String(node.name).trim(), source: 'jsonld', path: `${path}.name`,
		}));
	}

	if (node.description) {
		candidates.push(candidate({
			field: 'description', value: String(node.description).trim(),
			source: 'jsonld', path: `${path}.description`,
		}));
	}

	const image = asArray(node.image)[0];
	if (image) {
		const imageUrl = typeof image === 'string' ? image : image.url || image.contentUrl;
		if (imageUrl) {
			candidates.push(candidate({
				field: 'image', value: imageUrl, source: 'jsonld', path: `${path}.image`,
			}));
		}
	}

	const brand = node.brand;
	if (brand) {
		const brandName = typeof brand === 'string' ? brand : brand.name;
		if (brandName) {
			candidates.push(candidate({
				field: 'brand', value: String(brandName).trim(), source: 'jsonld', path: `${path}.brand`,
			}));
		}
	}

	for (const key of ['gtin13', 'gtin12', 'gtin8', 'gtin', 'mpn', 'sku']) {
		if (node[key]) {
			candidates.push(candidate({
				field: key.startsWith('gtin') ? 'gtin' : key,
				value: String(node[key]).trim(), source: 'jsonld', path: `${path}.${key}`,
			}));
		}
	}

	for (const { offer, path: offerPath } of offersOf(node, path)) {
		if (!offer || typeof offer !== 'object') continue;

		const priceInfo = priceFromOffer(offer, offerPath);
		if (priceInfo) {
			const value = parsePrice(priceInfo.value);
			if (value !== null) {
				candidates.push(candidate({
					field: 'price', value, raw: priceInfo.value,
					source: 'jsonld', path: priceInfo.path,
					evidence: `offers -> ${priceInfo.value}`,
					meta: { isRange: priceInfo.isRange },
				}));
			}
		}

		const currencyRaw = offer.priceCurrency
			|| asArray(offer.priceSpecification)[0]?.priceCurrency;
		if (currencyRaw) {
			candidates.push(candidate({
				field: 'currency', value: normalizeCurrency(currencyRaw, { url: doc.url, fallback: null }),
				raw: currencyRaw, source: 'jsonld', path: `${offerPath}.priceCurrency`,
			}));
		}

		if (offer.availability) {
			candidates.push(candidate({
				field: 'availability', value: normalizeAvailability(offer.availability),
				raw: offer.availability, source: 'jsonld', path: `${offerPath}.availability`,
			}));
		}

		if (offer.itemCondition) {
			candidates.push(candidate({
				field: 'condition', value: String(offer.itemCondition).split('/').pop(),
				raw: offer.itemCondition, source: 'jsonld', path: `${offerPath}.itemCondition`,
			}));
		}

		const seller = offer.seller;
		if (seller) {
			const sellerName = typeof seller === 'string' ? seller : seller.name;
			if (sellerName) {
				candidates.push(candidate({
					field: 'seller', value: String(sellerName).trim(),
					source: 'jsonld', path: `${offerPath}.seller`,
				}));
			}
		}
	}

	return compact(candidates);
}

module.exports = { extract, findProducts, priceFromOffer, hasType, asArray, name: 'jsonld' };
