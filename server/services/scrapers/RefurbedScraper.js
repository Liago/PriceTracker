const BaseScraper = require('./BaseScraper');

class RefurbedScraper extends BaseScraper {
	async scrape(url) {
		const store = 'refurbed';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			let price = null;
			let available = true;
			let description = null;
			const features = [];

			// Try JSON-LD structured data first (richest source)
			const scripts = document.querySelectorAll('script[type="application/ld+json"]');
			for (const script of scripts) {
				try {
					const json = JSON.parse(script.innerText);
					if (json['@type'] === 'Product') {
						if (json.offers) {
							const offer = Array.isArray(json.offers) ? json.offers[0] : json.offers;
							price = offer.price;
							if (offer.availability && !offer.availability.includes('InStock')) {
								available = false;
							}
						}
						if (json.description) {
							description = json.description;
						}
					}
				} catch (e) { }
			}

			// Fallback DOM price
			if (!price) {
				const priceEl = document.querySelector('[data-test="product-price"]');
				if (priceEl) price = priceEl.textContent;
			}

			// Features: extract product specifications from the page
			const specItems = document.querySelectorAll('[data-test="product-specs"] li, [class*="spec"] li, [class*="Spec"] li');
			specItems.forEach(el => {
				const text = el.textContent.trim();
				if (text.length > 2) features.push(text);
			});

			// Try key-value spec rows
			if (features.length === 0) {
				const rows = document.querySelectorAll('[class*="specification"] tr, [class*="Specification"] tr, [class*="attribute"] [class*="row"]');
				rows.forEach(row => {
					const text = row.textContent.trim().replace(/\s+/g, ' ');
					if (text.length > 2 && text.length < 200) features.push(text);
				});
			}

			// Try bullet points from product description area
			if (features.length === 0) {
				const bullets = document.querySelectorAll('[class*="product"] [class*="description"] li, [class*="Product"] [class*="Description"] li');
				bullets.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 2) features.push(text);
				});
			}

			// Fallback description from DOM
			if (!description) {
				const descEl = document.querySelector('[data-test="product-description"]') || document.querySelector('[class*="product-description"]');
				if (descEl) description = descEl.textContent.trim().substring(0, 500);
			}

			return { price, available, description, features };
		});

		if (pageData.price) data.price = pageData.price;
		if (pageData.available !== undefined) data.available = pageData.available;
		if (pageData.description && (!data.description || data.description.length < 50)) {
			data.description = pageData.description;
		}

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details };
	}
}

module.exports = RefurbedScraper;
