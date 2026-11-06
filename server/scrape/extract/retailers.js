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
/**
 * Il testo di un nodo prezzo Amazon.
 *
 * Per un contenitore `.a-price` si preferisce `.a-offscreen`, il testo per
 * l'accessibilita'; quando e' vuoto si ricompone il prezzo dai nodi visibili.
 * Le cifre della parte intera si ripuliscono dai separatori delle migliaia e
 * si uniscono ai decimali con un punto, cosi' "1.299," + "99" diventa
 * "1299.99" senza ambiguita' di locale.
 */
function amazonPriceText($, el) {
	const node = $(el);
	if (!node.is('.a-price')) return node.text();
	const offscreen = node.find('.a-offscreen').first().text().replace(/\s+/g, ' ').trim();
	if (/\d/.test(offscreen)) return offscreen;
	const whole = node.find('.a-price-whole').first().text().replace(/\D/g, '');
	if (!whole) return offscreen;
	const fraction = node.find('.a-price-fraction').first().text().replace(/\D/g, '');
	const symbol = node.find('.a-price-symbol').first().text().trim();
	return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`.trim();
}

/** Testo breve e senza script di un nodo, per la diagnostica. */
function snippet($, selector, max = 160) {
	const node = $(selector).first().clone();
	if (!node.length) return null;
	node.find('script, style, noscript').remove();
	return node.text().replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

/** Indizi delimitati sullo stato della scheda: niente pagina intera ne' dati di sessione. */
function amazonPageEvidence($) {
	const markers = ['#buybox', '#apex_desktop', '#desktop_qualifiedBuyBox', '#buybox-see-all-buying-choices',
		'#exports_desktop_undeliverable_buybox', '#outOfStock', '#availability', '#add-to-cart-button',
		'#nav-global-location-popover-link', '#all-offers-display', '#tp_price_block_total_price_ww'];
	const anywhere = $('.a-price').toArray().slice(0, 12).map(el => {
		const owner = $(el).parents('[id]').first();
		return { owner: (owner.attr('id') || '').slice(0, 80), text: amazonPriceText($, el).replace(/\s+/g, ' ').trim().slice(0, 40),
			class: ($(el).attr('class') || '').slice(0, 120) };
	});
	return {
		deliveryLocation: snippet($, '#glow-ingress-line2, #nav-global-location-slot', 80),
		availability: snippet($, '#availability, #availabilityInsideBuyBox_feature_div'),
		buyBox: snippet($, '#buybox, #desktop_qualifiedBuyBox, #apex_desktop', 300),
		undeliverable: snippet($, '#exports_desktop_undeliverable_buybox, #exportsUndeliverable-cart-button', 200),
		markers: Object.fromEntries(markers.map(m => [m, $(m).length])),
		pricesAnywhere: anywhere,
	};
}

/** Valuta dal simbolo, oppure dal dominio quando il simbolo manca. */
function currencyOf(text, url) {
	if (/€|EUR/.test(text)) return 'EUR';
	if (/£|GBP/.test(text)) return 'GBP';
	if (/\$|USD/.test(text)) return 'USD';
	try {
		const host = new URL(url).hostname;
		if (/amazon\.(it|de|fr|es)$/.test(host)) return 'EUR';
		if (/amazon\.co\.uk$/.test(host)) return 'GBP';
		if (/amazon\.com$/.test(host)) return 'USD';
	} catch { /* URL non valido: nessuna valuta. */ }
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
		// Ogni voce indica un nodo prezzo, non il suo testo: Amazon scrive il
		// prezzo da pagare su piu' nodi (a-price-whole, a-price-fraction,
		// a-price-symbol) e lascia sempre piu' spesso vuoto `.a-offscreen`.
		// Leggere solo quest'ultimo scartava come «non interpretabile» il
		// prezzo principale di pagine perfettamente leggibili.
		const selectors = [
			'#corePriceDisplay_desktop_feature_div .priceToPay',
			'#corePriceDisplay_desktop_feature_div .a-price',
			'#corePrice_feature_div .a-price',
			'#corePrice_desktop_feature_div .priceToPay',
			'#corePrice_desktop_feature_div .a-price',
			'#apex_desktop .priceToPay',
			'#apex_offerDisplay_desktop .priceToPay',
			'#corePriceDisplay_mobile_feature_div .priceToPay',
			'#priceblock_ourprice', '#priceblock_dealprice', '#price_inside_buybox', '#newBuyBoxPrice',
		];
		let found = false;
		const attempts = [];
		for (const selector of selectors) {
			const attempt = { selector, matched: 0, accepted: 0, rejected: {}, values: [] };
			const prices = [];
			$(selector).each((_, el) => {
				attempt.matched++;
				const text = amazonPriceText($, el), price = parsePrice(text);
				const reasons = [
					isStruck($, el) && 'struck', isHidden($, el) && 'hidden',
					isOffTopic($, el) && 'off_topic', hasAccessoryAncestor($, el) && 'accessory',
					$(el).closest('.a-text-price, [data-a-strike="true"], [id*="installment"], [id*="sns"]').length > 0 && 'non_primary_offer',
					price === null && 'unparseable',
				].filter(Boolean);
				for (const reason of reasons) attempt.rejected[reason] = (attempt.rejected[reason] || 0) + 1;
				if (!reasons.length) prices.push({ text, price });
			});
			attempt.accepted = prices.length;
			attempt.values = [...new Set(prices.map(x => x.price))].slice(0, 10);
			attempts.push(attempt);
			if (!prices.length) continue;
			if (new Set(prices.map(x => x.price)).size !== 1) break;
			add('price', prices[0].price, selector);
			add('currency', currencyOf(prices[0].text, doc.url), selector);
			found = true; break;
		}
		add('availability', normalizeAvailability($('#availability, #availabilityInsideBuyBox_feature_div').first().text().trim()), '#availability');
		if (!found) {
			const buyBox = $('#buybox, #apex_desktop, #desktop_qualifiedBuyBox').clone();
			buyBox.find('script, style, noscript').remove();
			const text = buyBox.text().replace(/\s+/g, ' ');
			const requiresCart = /(?:per (?:visualizzare|vedere).{0,100}aggiungi.{0,60}carrello|add.{0,60}(?:cart|basket).{0,60}(?:see|view).{0,30}price|(?:see|view).{0,30}price.{0,60}(?:cart|basket))/i.test(text);
			// Bounded price-only evidence: no full page, scripts, reviews or session attributes.
			const roots = ['#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div', '#corePrice_desktop_feature_div', '#apex_desktop', '#apex_offerDisplay_desktop', '#corePriceDisplay_mobile_feature_div', '#buybox', '#desktop_qualifiedBuyBox'];
			const priceNodes = $(roots.map(root => `${root} .a-price`).join(', ')).slice(0, 12).toArray().map(el => {
				const node = $(el).clone();
				node.find('script, style, noscript').remove();
				return {
					text: node.text().replace(/\s+/g, ' ').trim().slice(0, 100),
					ancestors: $(el).parents().toArray().slice(0, 8).map(parent => ({
						tag: parent.tagName, id: ($(parent).attr('id') || '').slice(0, 100),
						class: ($(parent).attr('class') || '').slice(0, 180),
					})),
					class: ($(el).attr('class') || '').slice(0, 180),
					offscreenCount: $(el).find('.a-offscreen').length,
				};
			});
			const priceDiagnostics = {
				retailer, status: attempts.some(a => a.values.length > 1) ? 'ambiguous_price'
					: attempts.some(a => a.matched > 0) ? 'all_candidates_rejected' : 'no_matching_selector',
				roots: Object.fromEntries(roots.map(root => [root, $(root).length])),
				attempts, priceNodes,
				// Perche' il prezzo manca, nei termini della pagina: dove Amazon
				// crede che si trovi chi la guarda, cosa dice la disponibilita' e
				// quali contenitori di acquisto ha servito al loro posto.
				page: amazonPageEvidence($),
			};
			add('price_status', requiresCart ? 'price_requires_cart' : 'main_price_unavailable', 'buy-box', { priceDiagnostics });
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
