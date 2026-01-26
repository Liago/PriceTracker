const BaseScraper = require('./BaseScraper');

class MediaWorldScraper extends BaseScraper {
	async scrape(url) {
		const store = 'mediaworld';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price
			let price = null;
			const priceEl = document.querySelector('[data-test="product-price"]');
			if (priceEl) {
				price = priceEl.innerText;
			} else {
				const metaPrice = document.querySelector('meta[itemprop="price"]');
				if (metaPrice) price = metaPrice.content;
			}

			// Availability
			const addToCartBtn = document.querySelector('[data-test="add-to-cart-button"]');
			const available = !!addToCartBtn && !addToCartBtn.disabled;

			// Features: extract product specifications
			const features = [];

			// MediaWorld product specs table
			const specRows = document.querySelectorAll('.specs-table tr, [class*="specification"] tr, [data-test="product-specs"] li');
			specRows.forEach(row => {
				const label = row.querySelector('td:first-child, th, .spec-label');
				const value = row.querySelector('td:last-child, .spec-value');
				if (label && value && label !== value) {
					const text = `${label.textContent.trim()}: ${value.textContent.trim()}`;
					if (text.length > 3) features.push(text);
				} else {
					const text = row.textContent.trim().replace(/\s+/g, ' ');
					if (text.length > 3 && text.length < 200) features.push(text);
				}
			});

			// Try bullet-point features
			if (features.length === 0) {
				const bullets = document.querySelectorAll('[class*="feature"] li, [class*="Feature"] li, [class*="highlight"] li, [class*="Highlight"] li');
				bullets.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 2) features.push(text);
				});
			}

			// Description
			const descEl = document.querySelector('[data-test="product-description"]') || document.querySelector('[class*="product-description"]') || document.querySelector('[itemprop="description"]');
			const description = descEl ? descEl.textContent.trim().substring(0, 500) : null;

			return { price, available, features, description };
		});

		if (pageData.price) data.price = pageData.price;
		if (pageData.description && (!data.description || data.description.length < 50)) {
			data.description = pageData.description;
		}

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details, available: pageData.available };
	}
}

module.exports = MediaWorldScraper;
