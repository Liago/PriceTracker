/**
 * E5 - Adapter di piattaforma.
 *
 * Non adapter per STORE, ma per PIATTAFORMA: e' la differenza che rende
 * realistico l'obiettivo di leggere qualunque shop. La coda lunga degli shop
 * italiani gira quasi tutta su Shopify, WooCommerce o PrestaShop, quindi un
 * solo pezzo di codice per piattaforma copre migliaia di siti - mentre un
 * pezzo di codice per store ne copre uno.
 *
 * Il valore aggiunto rispetto agli estrattori generici sono le VARIANTI: le
 * piattaforme espongono in pagina l'elenco completo con prezzo e disponibilita'
 * per ciascuna, che e' esattamente cio' che serve a product_offers.
 */

const { candidate, compact } = require('../candidate');
const { parsePrice } = require('../../normalize/price');
const { normalizeCurrency } = require('../../normalize/currency');
const { normalizeAvailability } = require('../../normalize/availability');
const { parseJsonLoosely } = require('../../document');

const PLATFORM = Object.freeze({
	SHOPIFY: 'shopify',
	WOOCOMMERCE: 'woocommerce',
	PRESTASHOP: 'prestashop',
	MAGENTO: 'magento',
	SHOPWARE: 'shopware',
	BIGCOMMERCE: 'bigcommerce',
	SALESFORCE: 'salesforce',
	UNKNOWN: null,
});

/**
 * Riconosce la piattaforma dai suoi indizi in pagina.
 * @param {import('../../document').ScrapeDocument} doc
 * @returns {{platform: string|null, evidence: string|null}}
 */
function detectPlatform(doc) {
	const html = doc.html || '';
	const generator = (doc.meta('generator') || '').toLowerCase();

	const checks = [
		[PLATFORM.SHOPIFY, () => /cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.theme|ShopifyAnalytics/.test(html), 'cdn shopify'],
		[PLATFORM.WOOCOMMERCE, () => generator.includes('woocommerce') || /wp-content\/plugins\/woocommerce/.test(html), 'plugin woocommerce'],
		[PLATFORM.PRESTASHOP, () => generator.includes('prestashop') || /window\.prestashop|prestashop-/.test(html), 'window.prestashop'],
		[PLATFORM.MAGENTO, () => /x-magento-init|Magento_|mage\/cookies/.test(html), 'x-magento-init'],
		[PLATFORM.SHOPWARE, () => generator.includes('shopware') || /data-product-information|shopware/i.test(html), 'shopware'],
		[PLATFORM.BIGCOMMERCE, () => /__BCData|bigcommerce/i.test(html), '__BCData'],
		[PLATFORM.SALESFORCE, () => /on\/demandware\.store|dwvar_|dwAnalytics/.test(html), 'demandware'],
	];

	for (const [platform, test, evidence] of checks) {
		try {
			if (test()) return { platform, evidence };
		} catch (e) {
			// un indizio che fallisce non deve fermare gli altri
		}
	}

	return { platform: PLATFORM.UNKNOWN, evidence: null };
}

/**
 * Shopify: il blocco ProductJson e ShopifyAnalytics.meta espongono il prodotto
 * completo di varianti, con i prezzi in CENTESIMI.
 */
function extractShopify(doc) {
	const $ = doc.$;
	const found = { product: null, source: null };

	// Blocco JSON del tema (nome variabile fra i temi, si cerca per prefisso).
	$('script[type="application/json"]').each((_, element) => {
		if (found.product) return;
		const id = $(element).attr('id') || '';
		if (!/product/i.test(id)) return;
		const parsed = parseJsonLoosely($(element).contents().text());
		if (parsed && (parsed.variants || parsed.price !== undefined)) {
			found.product = parsed;
			found.source = `script#${id}`;
		}
	});

	if (!found.product) {
		$('script').each((_, element) => {
			if (found.product) return;
			const code = $(element).contents().text();
			const match = /ShopifyAnalytics\.meta\s*=\s*/.exec(code);
			if (!match) return;
			const parsed = parseJsonLoosely(code.slice(match.index + match[0].length));
			if (parsed?.product) {
				found.product = parsed.product;
				found.source = 'ShopifyAnalytics.meta';
			}
		});
	}

	if (!found.product) return { candidates: [], variants: [] };

	const product = found.product;
	const candidates = [];

	// Shopify espone i prezzi in centesimi interi.
	const priceRaw = product.price ?? product.variants?.[0]?.price;
	const price = parsePrice(priceRaw, { cents: Number.isInteger(priceRaw) && priceRaw > 1000 });
	if (price !== null) {
		candidates.push(candidate({
			field: 'price', value: price, raw: priceRaw, source: 'platform',
			path: found.source, evidence: `shopify -> ${priceRaw}`,
			locator: { strategy: 'appstate' },
			meta: { platform: PLATFORM.SHOPIFY },
		}));
	}

	const currency = normalizeCurrency(product.currency ?? product.currencyCode, { url: doc.url, fallback: null });
	if (currency) {
		candidates.push(candidate({
			field: 'currency', value: currency, source: 'platform', path: found.source,
			locator: { strategy: 'appstate' },
		}));
	}

	if (product.title || product.name) {
		candidates.push(candidate({
			field: 'title', value: String(product.title || product.name).trim(),
			source: 'platform', path: found.source, locator: { strategy: 'appstate' },
		}));
	}

	// Le varianti sono il motivo per cui questo adapter esiste.
	const variants = (product.variants || []).map((variant) => ({
		id: variant.id ?? null,
		title: variant.title ?? variant.public_title ?? null,
		sku: variant.sku ?? null,
		price: parsePrice(variant.price, { cents: Number.isInteger(variant.price) && variant.price > 1000 }),
		available: variant.available ?? null,
		options: variant.options ?? null,
	})).filter((variant) => variant.price !== null);

	return { candidates: compact(candidates), variants };
}

/**
 * WooCommerce: le varianti stanno in un attributo data- del form del carrello.
 */
function extractWooCommerce(doc) {
	const raw = doc.attr('form.variations_form', 'data-product_variations')
		|| doc.attr('[data-product_variations]', 'data-product_variations');

	if (!raw || raw === 'false') return { candidates: [], variants: [] };

	const parsed = parseJsonLoosely(raw);
	if (!Array.isArray(parsed)) return { candidates: [], variants: [] };

	const variants = parsed.map((variant) => ({
		id: variant.variation_id ?? null,
		sku: variant.sku ?? null,
		price: parsePrice(variant.display_price ?? variant.price),
		available: variant.is_in_stock ?? null,
		options: variant.attributes ?? null,
	})).filter((variant) => variant.price !== null);

	const candidates = [];
	if (variants.length > 0) {
		candidates.push(candidate({
			field: 'price', value: variants[0].price, raw: variants[0].price, source: 'platform',
			path: 'form.variations_form[data-product_variations]',
			evidence: `woocommerce -> ${variants.length} varianti`,
			locator: { strategy: 'css', selector: 'form.variations_form', attr: 'data-product_variations' },
			meta: { platform: PLATFORM.WOOCOMMERCE, variantCount: variants.length },
		}));
	}

	return { candidates: compact(candidates), variants };
}

/**
 * PrestaShop: window.prestashop.product porta prezzo e disponibilita'.
 */
function extractPrestaShop(doc) {
	const $ = doc.$;
	let state = null;

	$('script').each((_, element) => {
		if (state) return;
		const code = $(element).contents().text();
		const match = /window\.prestashop\s*=\s*/.exec(code);
		if (!match) return;
		state = parseJsonLoosely(code.slice(match.index + match[0].length));
	});

	const product = state?.product;
	if (!product) return { candidates: [], variants: [] };

	const candidates = [];
	const price = parsePrice(product.price_amount ?? product.price);
	if (price !== null) {
		candidates.push(candidate({
			field: 'price', value: price, raw: product.price_amount ?? product.price,
			source: 'platform', path: 'window.prestashop.product',
			locator: { strategy: 'appstate' },
			meta: { platform: PLATFORM.PRESTASHOP },
		}));
	}

	if (product.availability) {
		candidates.push(candidate({
			field: 'availability', value: normalizeAvailability(product.availability),
			raw: product.availability, source: 'platform', path: 'window.prestashop.product.availability',
			locator: { strategy: 'appstate' },
		}));
	}

	return { candidates: compact(candidates), variants: [] };
}

const ADAPTERS = Object.freeze({
	[PLATFORM.SHOPIFY]: extractShopify,
	[PLATFORM.WOOCOMMERCE]: extractWooCommerce,
	[PLATFORM.PRESTASHOP]: extractPrestaShop,
});

/**
 * @param {import('../../document').ScrapeDocument} doc
 * @returns {Array} candidati
 */
function extract(doc) {
	const { platform } = detectPlatform(doc);
	if (!platform) return [];

	const adapter = ADAPTERS[platform];
	if (!adapter) return [];

	try {
		return adapter(doc).candidates;
	} catch (e) {
		return [];
	}
}

/**
 * Varianti riconosciute, per alimentare product_offers.
 * @returns {{platform: string|null, variants: Array}}
 */
function extractVariants(doc) {
	const { platform } = detectPlatform(doc);
	const adapter = platform ? ADAPTERS[platform] : null;
	if (!adapter) return { platform, variants: [] };

	try {
		return { platform, variants: adapter(doc).variants || [] };
	} catch (e) {
		return { platform, variants: [] };
	}
}

module.exports = { extract, extractVariants, detectPlatform, PLATFORM, name: 'platform' };
