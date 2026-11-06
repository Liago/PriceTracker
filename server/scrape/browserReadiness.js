/**
 * Runs inside the page: keep this function self-contained for Puppeteer.
 *
 * Per Amazon un prezzo e' «caricato» quando un nodo prezzo principale ha cifre
 * e valuta, nel testo per l'accessibilita' (`.a-offscreen`) oppure nei nodi
 * visibili `a-price-whole`/`a-price-fraction`: il markup recente lascia vuoto
 * il primo e attendere solo quello faceva scadere ogni attesa.
 */
function productReady() {
	if (location.hostname === 'swappie.com' || location.hostname.endsWith('.swappie.com')) {
		return Boolean(window.__INITIAL__DATA__?.productPageData?.selectedProduct);
	}
	if (/(^|\.)amazon\.(it|com|co\.uk|de|fr|es)$/.test(location.hostname)) {
		const roots = [
			'#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div', '#corePrice_desktop_feature_div',
			'#apex_desktop .priceToPay', '#apex_offerDisplay_desktop .priceToPay', '#corePriceDisplay_mobile_feature_div',
		];
		const nodes = [
			...document.querySelectorAll(roots.map(root => (root.endsWith('.priceToPay') ? root : `${root} .a-price`)).join(', ')),
			...document.querySelectorAll('#priceblock_ourprice, #priceblock_dealprice, #price_inside_buybox, #newBuyBoxPrice'),
		];
		const visible = el => {
			if (el.closest('.a-text-price, [data-a-strike="true"], del, s, [id*="sns"], [id*="installment"]')) return false;
			for (let node = el; node; node = node.parentElement) {
				if (node.hidden || node.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return false;
			}
			return true;
		};
		const textOf = el => {
			if (!el.classList.contains('a-price')) return el.textContent || '';
			const offscreen = el.querySelector('.a-offscreen')?.textContent || '';
			if (/\d/.test(offscreen)) return offscreen;
			const whole = el.querySelector('.a-price-whole')?.textContent || '';
			const symbol = el.querySelector('.a-price-symbol')?.textContent || '';
			return /\d/.test(whole) ? `${whole} ${symbol}` : '';
		};
		if (nodes.some(el => {
			if (!visible(el)) return false;
			const text = textOf(el);
			return /\d/.test(text) && /€|EUR|£|GBP|\$|USD/.test(text);
		})) return true;
		// In-stock availability often precedes the asynchronously loaded price.
		const availability = document.querySelector('#availability, #availabilityInsideBuyBox_feature_div')?.textContent || '';
		if (/attualmente non disponibile|currently unavailable|non disponibile|out of stock/i.test(availability)) return true;
		const box = document.querySelector('#buybox, #apex_desktop');
		if (box) {
			const copy = box.cloneNode(true);
			copy.querySelectorAll('script, style, noscript').forEach(el => el.remove());
			return /(?:per (?:visualizzare|vedere).{0,100}aggiungi.{0,60}carrello|(?:see|view).{0,30}price.{0,60}(?:cart|basket))/i.test(copy.textContent.replace(/\s+/g, ' '));
		}
		return false;
	}
	return Boolean(document.querySelector('script[type="application/ld+json"], [itemprop="price"], [class*="price"]'));
}

module.exports = { productReady };
