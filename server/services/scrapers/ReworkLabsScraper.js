const BaseScraper = require('./BaseScraper');

class ReworkLabsScraper extends BaseScraper {
	async scrape(url) {
		const store = 'reworklabs';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price - Try to find the actual current price, ignoring original price
			// Looking at the output "Il prezzo attuale è: 949,00€.", we can look for specific structure
			// Or just grab the last price-like string?
			// Better: find .price--highlight or similar if exists, or parse the messy text

			const el = document.querySelector('.product-price') || document.querySelector('.price') || document.querySelector('#ProductPrice-product-template');
			let priceText = el ? el.innerText : null;

			// Availability: Check for "sold out" or "non disponibile"
			const btn = document.querySelector('.product-form__cart-submit');
			const btnText = btn ? btn.innerText.toLowerCase() : '';
			const available = !btnText.includes('esaurito') && !btnText.includes('sold out');

			return { priceText, available };
		});

		if (pageData.priceText) {
			// Regex to extract the last price occurrence (usually the discounted/current one)
			// Matches 949,00 or 1.099,00
			const matches = pageData.priceText.match(/[\d\.]+,[\d]{2}/g);
			if (matches && matches.length > 0) {
				// Take the last one (usually discounted)
				data.price = matches[matches.length - 1];
			}
		}

		data.available = pageData.available;

		return { ...data, store };
	}
}

module.exports = ReworkLabsScraper;
