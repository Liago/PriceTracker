const BaseScraper = require('./BaseScraper');

class SmartGenerationScraper extends BaseScraper {
	async scrape(url) {
		const store = 'smartgeneration';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price
			const priceEl = document.querySelector('.price');
			let price = priceEl ? priceEl.innerText : null;

			// Availability
			const addToCartBtn = document.querySelector('#product-addtocart-button') || document.querySelector('button[title="Aggiungi al Carrello"]');
			const available = !!addToCartBtn && !addToCartBtn.disabled;

			// Features: extract product specifications
			const features = [];

			// Magento specs table (product-attribute-specs-table)
			const specRows = document.querySelectorAll('#product-attribute-specs-table tr, .additional-attributes tr');
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

			// Description
			const descEl = document.querySelector('.product.attribute.description .value') || document.querySelector('.product-info-description') || document.querySelector('[itemprop="description"]');
			const description = descEl ? descEl.textContent.trim().substring(0, 500) : null;

			return { price, available, features, description };
		});

		if (pageData.price) {
			// Regex for "1.234,56" or "123,45"
			const matches = pageData.price.match(/[\d\.]+,[\d]{2}/);
			if (matches) {
				data.price = matches[0];
			} else {
				data.price = pageData.price.trim();
			}
		}

		if (pageData.description && (!data.description || data.description.length < 50)) {
			data.description = pageData.description;
		}

		// If availability check failed but we have a price, assume available
		if (pageData.available) {
			data.available = true;
		} else {
			if (data.price) data.available = true;
		}

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details };
	}
}

module.exports = SmartGenerationScraper;
