/**
 * E2 - Microdata e RDFa (itemprop di schema.org).
 *
 * Formato piu' vecchio del JSON-LD ma ancora diffuso, soprattutto su
 * PrestaShop, Magento 1 e template artigianali. Quando c'e', e' una sorgente
 * strutturata: molto piu' affidabile di qualunque euristica sul DOM.
 */

const { candidate, compact } = require('./candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeCurrency } = require('../normalize/currency');
const { normalizeAvailability } = require('../normalize/availability');

/**
 * Valore di un itemprop: l'attributo dedicato se c'e', altrimenti il testo.
 * L'ordine conta - su <meta itemprop="price" content="729.00">729,00 €</meta>
 * il valore buono e' l'attributo.
 */
function propValue($, element) {
	const node = $(element);
	const tag = (element.tagName || element.name || '').toLowerCase();

	if (tag === 'meta') return node.attr('content') ?? null;
	if (tag === 'link' || tag === 'a') return node.attr('href') ?? null;
	if (tag === 'img') return node.attr('src') ?? node.attr('content') ?? null;
	if (tag === 'time') return node.attr('datetime') ?? node.text().trim();

	const content = node.attr('content');
	if (content !== undefined && content !== '') return content;

	const text = node.text().replace(/\s+/g, ' ').trim();
	return text === '' ? null : text;
}

/**
 * @param {import('../document').ScrapeDocument} doc
 * @returns {Array} candidati
 */
function extract(doc) {
	const $ = doc.$;
	const candidates = [];

	// Ambito: se la pagina dichiara un itemtype Product ci si limita a quello,
	// altrimenti si cercano gli itemprop ovunque.
	const scopes = $('[itemtype*="schema.org/Product"], [itemtype*="schema.org/IndividualProduct"]');
	const root = scopes.length > 0 ? scopes.first() : $.root();
	const within = (selector) => root.find(selector);

	const first = (selector) => {
		const found = within(selector);
		return found.length > 0 ? found.first() : null;
	};

	const readProp = (name) => {
		const node = first(`[itemprop="${name}"]`);
		if (!node) return null;
		return propValue($, node[0]);
	};

	const priceRaw = readProp('price');
	if (priceRaw !== null) {
		const value = parsePrice(priceRaw);
		if (value !== null) {
			candidates.push(candidate({
				field: 'price', value, raw: priceRaw, source: 'microdata',
				path: '[itemprop=price]', evidence: String(priceRaw).slice(0, 60),
			}));
		}
	}

	const currencyRaw = readProp('priceCurrency');
	if (currencyRaw) {
		candidates.push(candidate({
			field: 'currency', value: normalizeCurrency(currencyRaw, { url: doc.url, fallback: null }),
			raw: currencyRaw, source: 'microdata', path: '[itemprop=priceCurrency]',
		}));
	}

	const availabilityRaw = readProp('availability');
	if (availabilityRaw) {
		candidates.push(candidate({
			field: 'availability', value: normalizeAvailability(availabilityRaw),
			raw: availabilityRaw, source: 'microdata', path: '[itemprop=availability]',
		}));
	}

	const simpleFields = [
		['name', 'title'],
		['description', 'description'],
		['image', 'image'],
		['sku', 'sku'],
		['mpn', 'mpn'],
		['gtin13', 'gtin'],
		['brand', 'brand'],
	];

	for (const [prop, field] of simpleFields) {
		const value = readProp(prop);
		if (value) {
			candidates.push(candidate({
				field, value: String(value).trim(), source: 'microdata', path: `[itemprop=${prop}]`,
			}));
		}
	}

	return compact(candidates);
}

module.exports = { extract, propValue, name: 'microdata' };
