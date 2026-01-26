const BaseScraper = require('./BaseScraper');

class SwappieScraper extends BaseScraper {
	async scrape(url) {
		const store = 'swappie';
		const generic = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price
			let price = null;
			const priceSelectors = [
				'[class*="price"] [class*="value"]',
				'[class*="Price"]',
				'h2[class*="price"]',
				'div[class*="price"] span',
				'[data-testid="price"]'
			];
			for (const selector of priceSelectors) {
				const el = document.querySelector(selector);
				if (el) {
					const text = el.textContent.trim();
					if (text.match(/€\s*\d{3,}/) || text.match(/\d{3,}\s*€/)) {
						price = text;
						break;
					}
				}
			}

			// Features: extract product specifications
			const features = [];

			// Swappie shows specs like Storage, Color, Condition in structured sections
			const specItems = document.querySelectorAll('[class*="spec"] li, [class*="Spec"] li, [class*="attribute"] li, [class*="Attribute"] li');
			specItems.forEach(el => {
				const text = el.textContent.trim();
				if (text.length > 2) features.push(text);
			});

			// Try key-value pairs in product details
			if (features.length === 0) {
				const detailRows = document.querySelectorAll('[class*="detail"] [class*="row"], [class*="Detail"] [class*="Row"]');
				detailRows.forEach(row => {
					const text = row.textContent.trim().replace(/\s+/g, ' ');
					if (text.length > 2 && text.length < 200) features.push(text);
				});
			}

			// Description
			const descEl = document.querySelector('[class*="description"]') || document.querySelector('[class*="Description"]');
			const description = descEl ? descEl.textContent.trim().substring(0, 500) : null;

			// Availability
			const outOfStock = document.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"]');
			const available = !outOfStock;

			return { price, features, description, available };
		});

		let price = generic.price;
		if (pageData.price) price = pageData.price;

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		if (pageData.description && (!generic.description || generic.description.length < 50)) {
			generic.description = pageData.description;
		}

		return {
			...generic,
			price,
			store,
			details,
			available: pageData.available
		};
	}
}

module.exports = SwappieScraper;
