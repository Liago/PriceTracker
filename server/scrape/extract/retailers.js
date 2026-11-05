/** Store contracts: a generic price is not enough to identify an offer. */
const { candidate, compact } = require('./candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeAvailability } = require('../normalize/availability');
const { parseJsonLoosely } = require('../document');
const { isStruck, isHidden, isOffTopic, hasAccessoryAncestor } = require('./domHeuristics');
function retailerOf(url) {
	try {
		const host = new URL(url).hostname.replace(/^www\./, '');
		if (/^amazon\.(it|com|co\.uk|de|fr|es)$/.test(host)) return 'amazon';
		if (host === 'swappie.com') return 'swappie';
	} catch { /* Not a retailer URL. */ }
	return null;
}
function extract(doc) {
	const retailer = retailerOf(doc.url);
	if (!retailer) return null;
	const fields = [];
	const add = (field, value, path, meta = {}) => fields.push(candidate({ field, value, source: 'platform', weight: 0.95, path, locator: null, meta: { retailer, ...meta } }));
	const $ = doc.$;
	if (retailer === 'amazon') {
		add('title', $('#productTitle').text().trim() || doc.meta('og:title'), '#productTitle');
		add('image', $('#landingImage').attr('src') || doc.meta('og:image'), '#landingImage');
		const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(doc.url)?.[1];
		if (asin) add('sku', asin.toUpperCase(), 'url:asin');
		const selectors = ['#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', '#corePrice_feature_div .a-price .a-offscreen', '#apex_desktop .priceToPay .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice'];
		let found = false;
		for (const selector of selectors) {
			const prices = $(selector).toArray().filter(el => !isStruck($, el) && !isHidden($, el) && !isOffTopic($, el) && !hasAccessoryAncestor($, el) && !$(el).closest('.a-text-price, [data-a-strike="true"], [id*="installment"], [id*="sns"]').length)
				.map(el => ({ text: $(el).text(), price: parsePrice($(el).text()) })).filter(x => x.price !== null);
			if (!prices.length) continue;
			if (new Set(prices.map(x => x.price)).size !== 1) break;
			add('price', prices[0].price, selector);
			add('currency', /€|EUR/.test(prices[0].text) ? 'EUR' : /£|GBP/.test(prices[0].text) ? 'GBP' : /\$|USD/.test(prices[0].text) ? 'USD' : null, selector);
			found = true; break;
		}
		add('availability', normalizeAvailability($('#availability, #availabilityInsideBuyBox_feature_div').first().text().trim()), '#availability');
		if (!found) {
			const buyBox = $('#buybox, #apex_desktop, #desktop_qualifiedBuyBox').clone();
			buyBox.find('script, style, noscript').remove();
			const text = buyBox.text().replace(/\s+/g, ' ');
			const requiresCart = /(?:per (?:visualizzare|vedere).{0,100}aggiungi.{0,60}carrello|add.{0,60}(?:cart|basket).{0,60}(?:see|view).{0,30}price|(?:see|view).{0,30}price.{0,60}(?:cart|basket))/i.test(text);
			add('price_status', requiresCart ? 'price_requires_cart' : 'main_price_unavailable', 'buy-box');
		}
	} else {
		let state;
		$('script:not([src])').each((_, el) => {
			const text = $(el).contents().text(), match = /window\.__INITIAL__DATA__\s*=\s*/.exec(text);
			if (match) state = parseJsonLoosely(text.slice(match.index + match[0].length));
		});
		const product = state?.productPageData?.selectedProduct;
		if (!product) {
			add('title', doc.meta('og:title'), 'og:title'); add('image', doc.meta('og:image'), 'og:image');
			add('price_status', 'selected_variant_unavailable', 'selectedProduct'); return compact(fields);
		}
		const money = product.normalPrice;
		if (money && Number.isInteger(money.precision) && money.precision >= 0 && money.precision <= 4 && Number.isFinite(Number(money.amount))) {
			add('price', parsePrice(Number(money.amount) / 10 ** money.precision), 'selectedProduct.normalPrice');
			add('currency', money.currency, 'selectedProduct.normalPrice.currency');
		}
		add('title', product.englishName || product.name, 'selectedProduct.name'); add('image', doc.meta('og:image'), 'og:image');
		add('sku', product.id, 'selectedProduct.id'); add('seller', 'Swappie', 'selectedProduct'); add('condition', 'RefurbishedCondition', 'selectedProduct');
		add('variant', Object.fromEntries(['storage', 'color', 'grade', 'batteryType'].filter(k => product[k] != null).map(k => [k, String(product[k])])), 'selectedProduct');
		add('availability', Number.isFinite(product.stock) ? (product.stock > 0 ? 'in_stock' : 'out_of_stock') : 'unknown', 'selectedProduct.stock');
		const visible = $('[data-testid="summary-price-column"]').first().find('p').first().text(), visiblePrice = parsePrice(visible);
		if (visiblePrice !== null && fields.find(f => f.field === 'price')?.value !== visiblePrice) add('price_status', 'conflicting_selected_price', 'summary-price-column');
	}
	return compact(fields);
}
module.exports = { extract, retailerOf, name: 'retailer' };
