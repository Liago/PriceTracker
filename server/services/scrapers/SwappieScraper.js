const BaseScraper = require('./BaseScraper');

class SwappieScraper extends BaseScraper {
	async scrape(url) {
		const store = 'swappie';
		const generic = await this.getGenericMetadata();

		let price = generic.price;

		if (!price) {
			price = await this.page.evaluate(() => {
				const selectors = [
					'[class*="price"] [class*="value"]',
					'[class*="Price"]',
					'h2[class*="price"]',
					'div[class*="price"] span',
					'[data-testid="price"]'
				];

				for (const selector of selectors) {
					const el = document.querySelector(selector);
					if (el) {
						const text = el.textContent.trim();
						if (text.match(/€\s*\d{3,}/) || text.match(/\d{3,}\s*€/)) {
							return text;
						}
					}
				}
				return null;
			});
		}

		return {
			...generic,
			price,
			store,
			available: true // Swappie usually hides unavailable items or shows "Out of stock" clearly, implemented simply for now
		};
	}
}

module.exports = SwappieScraper;
