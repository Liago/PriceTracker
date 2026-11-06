/** Runs inside the page: keep this function self-contained for Puppeteer. */
function productReady() {
	if (location.hostname === 'swappie.com' || location.hostname.endsWith('.swappie.com')) {
		return Boolean(window.__INITIAL__DATA__?.productPageData?.selectedProduct);
	}
	if (/(^|\.)amazon\.(it|com|co\.uk|de|fr|es)$/.test(location.hostname)) {
		const prices = document.querySelectorAll([
			'#corePriceDisplay_desktop_feature_div .a-offscreen', '#corePrice_feature_div .a-offscreen',
			'#corePrice_desktop_feature_div .a-offscreen', '#apex_desktop .priceToPay .a-offscreen',
			'#priceblock_ourprice', '#priceblock_dealprice', '#price_inside_buybox', '#newBuyBoxPrice',
		].join(', '));
		if (Array.from(prices).some(el => {
			if (el.closest('.a-text-price, [data-a-strike="true"], del, s, [id*="sns"], [id*="installment"]')) return false;
			for (let node = el; node; node = node.parentElement) {
				if (node.hidden || node.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return false;
			}
			return /\d/.test(el.textContent) && /€|EUR|£|GBP|\$|USD/.test(el.textContent);
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
