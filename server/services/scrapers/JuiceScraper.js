const BaseScraper = require('./BaseScraper');

class JuiceScraper extends BaseScraper {
	async scrape(url) {
		const store = 'juice';
		const data = await this.getGenericMetadata();

		const refinedData = await this.page.evaluate(() => {
			const priceEl = document.querySelector('[data-price-type="finalPrice"] .price') || document.querySelector('.price-box .price');

			// Availability
			const stockEl = document.querySelector('.stock.available span');
			const available = stockEl ? !stockEl.innerText.toLowerCase().includes('non disponibile') : true;

			return {
				price: priceEl ? priceEl.innerText.trim() : null,
				available
			};
		});

		if (refinedData.price) data.price = refinedData.price;
		data.available = refinedData.available;

		return { ...data, store };
	}
}

module.exports = JuiceScraper;
