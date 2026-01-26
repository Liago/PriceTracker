const BaseScraper = require('./BaseScraper');

class RefurbedScraper extends BaseScraper {
	async scrape(url) {
		const store = 'refurbed';
		const data = await this.getGenericMetadata();

		// Refurbed has a specific structure
		const pageData = await this.page.evaluate(() => {
			// Often they use JSON-LD
			let price = null;
			let available = true;

			const script = document.querySelector('script[type="application/ld+json"]');
			if (script) {
				try {
					const json = JSON.parse(script.innerText);
					// Look for Product -> offers
					if (json['@type'] === 'Product' && json.offers) {
						const offer = Array.isArray(json.offers) ? json.offers[0] : json.offers;
						price = offer.price;
						if (offer.availability && !offer.availability.includes('InStock')) {
							available = false;
						}
					}
				} catch (e) { }
			}

			// Fallback DOM
			if (!price) {
				const priceEl = document.querySelector('[data-test="product-price"]');
				if (priceEl) price = priceEl.textContent;
			}

			return { price, available };
		});

		if (pageData.price) data.price = pageData.price;
		if (pageData.available !== undefined) data.available = pageData.available;

		return { ...data, store };
	}
}

module.exports = RefurbedScraper;
