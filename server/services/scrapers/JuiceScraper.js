const BaseScraper = require('./BaseScraper');

class JuiceScraper extends BaseScraper {
	async scrape(url) {
		const store = 'juice';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			let jsonLd = {};
			try {
				const scripts = document.querySelectorAll('script[type="application/ld+json"]');
				for (const script of scripts) {
					const json = JSON.parse(script.innerText);
					if (json['@type'] === 'Product') {
						jsonLd = json;
						break;
					}
				}
			} catch (e) { }

			// Price
			const priceEl = document.querySelector('[data-price-type="finalPrice"] .price') || document.querySelector('.price-box .price');
			let price = priceEl ? priceEl.innerText.trim() : null;
			if (!price && jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// Availability
			const stockEl = document.querySelector('.stock.available span');
			let available = stockEl ? !stockEl.innerText.toLowerCase().includes('non disponibile') : true;

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock');
				}
			}

			// Features: extract product specifications
			const features = [];

			// Magento specs table
			const specRows = document.querySelectorAll('#product-attribute-specs-table tr, .additional-attributes tr, .product-specs tr');
			specRows.forEach(row => {
				const label = row.querySelector('th, td:first-child');
				const value = row.querySelector('td:last-child, td.data');
				if (label && value && label !== value) {
					const text = `${label.textContent.trim()}: ${value.textContent.trim()}`;
					if (text.length > 3) features.push(text);
				}
			});

			// Try product description bullet points
			if (features.length === 0) {
				const bullets = document.querySelectorAll('.product.attribute.description li, .product-info-description li, .product.description li');
				bullets.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 2) features.push(text);
				});
			}

			// Try generic feature/highlight lists
			if (features.length === 0) {
				const highlights = document.querySelectorAll('[class*="feature"] li, [class*="highlight"] li');
				highlights.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 2) features.push(text);
				});
			}

			// Description
			const descEl = document.querySelector('.product.attribute.description .value') || document.querySelector('.product-info-description') || document.querySelector('[itemprop="description"]');
			let description = descEl ? descEl.textContent.trim().substring(0, 500) : null;
			if (!description && jsonLd.description) description = jsonLd.description.substring(0, 500);

			return { price, available, features, description };
		});

		if (pageData.price) data.price = pageData.price;
		data.available = pageData.available;

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

module.exports = JuiceScraper;
