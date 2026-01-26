const BaseScraper = require('./BaseScraper');

class SmartGenerationScraper extends BaseScraper {
	async scrape(url) {
		const store = 'smartgeneration';
		const data = await this.getGenericMetadata();

		const refinedData = await this.page.evaluate(() => {
			const priceEl = document.querySelector('.product-info-price .price');
			let price = priceEl ? priceEl.innerText.trim() : null;

			// Check availability
			const stockEl = document.querySelector('.stock.available');
			const available = !!stockEl; // If element exists it's usually in stock

			return {
				price,
				available
			};
		});

		if (refinedData.price) {
			// Cleanup: "1.269,00€" -> remove currency symbol if needed (parsePrice utility handles it usually, but clean is better)
			data.price = refinedData.price;
		}
		data.available = refinedData.available;

		return { ...data, store };
	}
}

module.exports = SmartGenerationScraper;
