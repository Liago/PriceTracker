/**
 * E3 - Meta tag Open Graph e product.
 *
 * Peso basso di proposito: i meta sono spesso generati una volta e non
 * aggiornati, o si riferiscono alla variante di default invece che a quella
 * mostrata. Restano utili come conferma incrociata e come unica sorgente su
 * pagine altrimenti mute.
 */

const { candidate, compact } = require('./candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeCurrency } = require('../normalize/currency');
const { normalizeAvailability } = require('../normalize/availability');

const PRICE_KEYS = ['product:price:amount', 'og:price:amount', 'product:price', 'price'];
const CURRENCY_KEYS = ['product:price:currency', 'og:price:currency', 'priceCurrency'];
const AVAILABILITY_KEYS = ['product:availability', 'og:availability', 'availability'];

/**
 * @param {import('../document').ScrapeDocument} doc
 * @returns {Array} candidati
 */
function extract(doc) {
	const candidates = [];

	const firstMeta = (keys) => {
		for (const key of keys) {
			const value = doc.meta(key);
			if (value) return { key, value };
		}
		return null;
	};

	const price = firstMeta(PRICE_KEYS);
	if (price) {
		const value = parsePrice(price.value);
		if (value !== null) {
			candidates.push(candidate({
				field: 'price', value, raw: price.value, source: 'meta',
				path: `meta[${price.key}]`, evidence: price.value,
				locator: { strategy: 'meta', key: price.key },
			}));
		}
	}

	const currency = firstMeta(CURRENCY_KEYS);
	if (currency) {
		candidates.push(candidate({
			field: 'currency', value: normalizeCurrency(currency.value, { url: doc.url, fallback: null }),
			raw: currency.value, source: 'meta', path: `meta[${currency.key}]`,
			locator: { strategy: 'meta', key: currency.key },
		}));
	}

	const availability = firstMeta(AVAILABILITY_KEYS);
	if (availability) {
		candidates.push(candidate({
			field: 'availability', value: normalizeAvailability(availability.value),
			raw: availability.value, source: 'meta', path: `meta[${availability.key}]`,
			locator: { strategy: 'meta', key: availability.key },
		}));
	}

	const title = doc.meta('og:title') || doc.meta('twitter:title');
	if (title) {
		candidates.push(candidate({ field: 'title', value: title.trim(), source: 'meta', path: 'meta[og:title]', locator: { strategy: 'meta', key: 'og:title' } }));
	}

	const image = doc.meta('og:image') || doc.meta('twitter:image');
	if (image) {
		candidates.push(candidate({ field: 'image', value: image, source: 'meta', path: 'meta[og:image]', locator: { strategy: 'meta', key: 'og:image' } }));
	}

	const description = doc.meta('og:description') || doc.meta('description');
	if (description) {
		candidates.push(candidate({
			field: 'description', value: description.trim(), source: 'meta', path: 'meta[og:description]',
			locator: { strategy: 'meta', key: 'og:description' },
		}));
	}

	const brand = doc.meta('product:brand') || doc.meta('og:brand');
	if (brand) {
		candidates.push(candidate({ field: 'brand', value: brand.trim(), source: 'meta', path: 'meta[product:brand]', locator: { strategy: 'meta', key: 'product:brand' } }));
	}

	// Il titolo della pagina come ultima risorsa, con peso ancora piu' basso:
	// contiene quasi sempre il nome dello store in coda.
	if (!title) {
		const pageTitle = doc.title();
		if (pageTitle) {
			candidates.push(candidate({ field: 'title', value: pageTitle, source: 'title', path: 'title', locator: { strategy: 'css', selector: 'title', attr: null } }));
		}
	}

	return compact(candidates);
}

module.exports = { extract, name: 'meta' };
