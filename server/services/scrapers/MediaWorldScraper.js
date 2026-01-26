const BaseScraper = require('./BaseScraper');

class MediaWorldScraper extends BaseScraper {
	async scrape(url) {
		const store = 'mediaworld';
		const data = await this.getGenericMetadata();

		// MediaWorld often uses shadow DOM or specific data attributes. 
		// Since generic metadata usually works well on modern sites, we start there.

		// Refine Price
		const pagePrice = await this.page.evaluate(() => {
			// Try to find price in specific MW containers
			// Often dynamic, but checking common patterns
			const el = document.querySelector('[data-test="product-price"]');
			if (el) return el.innerText;

			// Fallback to meta if not found in DOM
			const metaPrice = document.querySelector('meta[itemprop="price"]');
			return metaPrice ? metaPrice.content : null;
		});

		if (pagePrice) data.price = pagePrice;

		// Availability check
		const available = await this.page.evaluate(() => {
			const addToCartBtn = document.querySelector('[data-test="add-to-cart-button"]');
			return !!addToCartBtn && !addToCartBtn.disabled;
		});

		return { ...data, store, available };
	}
}

module.exports = MediaWorldScraper;
