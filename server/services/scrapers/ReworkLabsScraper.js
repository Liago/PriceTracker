const BaseScraper = require('./BaseScraper');

class ReworkLabsScraper extends BaseScraper {
	async scrape(url) {
		const store = 'reworklabs';

		// Wait for Shopify content to render. Increased timeout to 15s to avoid premature failures.
		try {
			await this.page.waitForSelector('.product-price, .price, #ProductPrice-product-template', { timeout: 15000 });
		} catch (_) {
			// Continue even if the selector isn't found — we'll fall back to OG metadata
		}

		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price
			const el = document.querySelector('.product-price') || document.querySelector('.price') || document.querySelector('#ProductPrice-product-template');
			let priceText = el ? el.innerText : null;

			// Availability: Check for "sold out" or "non disponibile"
			const btn = document.querySelector('.product-form__cart-submit');
			const btnText = btn ? btn.innerText.toLowerCase() : '';
			const available = !btnText.includes('esaurito') && !btnText.includes('sold out');

			// Title: Shopify product title
			const titleEl = document.querySelector('.product-single__title') || document.querySelector('h1.product__title') || document.querySelector('h1');
			const title = titleEl ? titleEl.textContent.trim() : null;

			// Image: Shopify product image
			const imgEl = document.querySelector('.product-single__photo img') || document.querySelector('.product__media img') || document.querySelector('.product-featured-img');
			const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null;

			// Description: Prefer the rich description container if available
			const richDescEl = document.querySelector('.contenuto-descrizione') || document.querySelector('.product-single__description') || document.querySelector('.product__description');
			const description = richDescEl ? richDescEl.textContent.trim() : null;

			// Features extraction
			let features = [];

			// Strategy 1: Look for "Caratteristiche principali" list in rich description
			if (richDescEl) {
				const headers = richDescEl.querySelectorAll('h3, h4, strong');
				for (const header of headers) {
					if (header.textContent.toLowerCase().includes('caratteristiche')) {
						// Look for the next UL
						let nextFn = header.nextElementSibling;
						while (nextFn && nextFn.tagName !== 'UL' && nextFn.tagName !== 'H3') {
							nextFn = nextFn.nextElementSibling;
						}
						if (nextFn && nextFn.tagName === 'UL') {
							features = Array.from(nextFn.querySelectorAll('li')).map(li => li.textContent.trim());
							break;
						}
					}
				}

				// If no specific header found, try to just grab all LIs if reasonable amount
				if (features.length === 0) {
					const allLis = richDescEl.querySelectorAll('ul li');
					if (allLis.length > 0 && allLis.length < 20) {
						features = Array.from(allLis).map(li => li.textContent.trim());
					}
				}
			}

			// Strategy 2: Fallback to parsing the short description paragraph (Key: Value)
			// e.g. "Famiglia processore: Apple M, Modello del processore: M1."
			if (features.length === 0) {
				const shortDescEl = document.querySelector('.woocommerce-product-details__short-description p');
				if (shortDescEl) {
					const text = shortDescEl.textContent;
					// Split by period or comma, but filter for likely features (containing ":")
					const parts = text.split(/[.,]\s+/);
					// Filter for parts that look like "Key: Value"
					const potentialFeatures = parts.filter(p => p.includes(':') && p.trim().length > 3);
					if (potentialFeatures.length > 2) {
						features = potentialFeatures.map(p => p.trim());
					}
				}
			}

			return { priceText, available, title, image, description, features };
		});

		if (pageData.priceText) {
			// Regex to extract the last price occurrence (usually the discounted/current one)
			const matches = pageData.priceText.match(/[\d\.]+,[\d]{2}/g);
			if (matches && matches.length > 0) {
				data.price = matches[matches.length - 1];
			}
		}

		if (pageData.title) data.title = pageData.title;
		if (pageData.image) data.image = pageData.image;
		// Keep the detailed description as main description if found, otherwise use default
		if (pageData.description) data.description = pageData.description;
		data.available = pageData.available;

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details };
	}
}

module.exports = ReworkLabsScraper;
