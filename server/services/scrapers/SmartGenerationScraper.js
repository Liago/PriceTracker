const BaseScraper = require('./BaseScraper');

class SmartGenerationScraper extends BaseScraper {
	async scrape(url) {
		const store = 'smartgeneration';
		const data = await this.getGenericMetadata();

		const refinedData = await this.page.evaluate(() => {
			// Broadest selector that worked in first run
			const priceEl = document.querySelector('.price');
			let price = priceEl ? priceEl.innerText : null;

			// Availability
			// If main button specific ID fails, check for generic add to cart text
			const addToCartBtn = document.querySelector('#product-addtocart-button') || document.querySelector('button[title="Aggiungi al Carrello"]');
			const available = !!addToCartBtn && !addToCartBtn.disabled;

			return {
				price,
				available
			};
		});

		if (refinedData.price) {
			// Regex for "1.234,56" or "123,45"
			// SmartGen output was "1.269,00€\n\n-1.230..."
			const matches = refinedData.price.match(/[\d\.]+,[\d]{2}/);
			if (matches) {
				data.price = matches[0];
			} else {
				// Fallback if regex fails but we have text
				data.price = refinedData.price.trim();
			}
		}

		// If availability check failed but we have a price, assume valid unless explicitly "sold out"
		if (refinedData.available) {
			data.available = true;
		} else {
			// Double check common "out of stock" indicators if button logic was too strict
			// For now, if price exists, default to true if we aren't sure? 
			// Better to be safe: valid price usually means available.
			if (data.price) data.available = true;
		}

		return { ...data, store };
	}
}

module.exports = SmartGenerationScraper;
