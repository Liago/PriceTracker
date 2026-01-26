const BaseScraper = require('./BaseScraper');

class ReworkLabsScraper extends BaseScraper {
	async scrape(url) {
		const store = 'reworklabs';

		// Wait for Shopify content to render before extracting data
		try {
			await this.page.waitForSelector('.product-price, .price, #ProductPrice-product-template', { timeout: 8000 });
		} catch (_) {
			// Continue even if the selector isn't found — we'll fall back to OG metadata
		}

		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Price
			const el = document.querySelector('.product-price') || document.querySelector('.price') || document.querySelector('#ProductPrice-product-template');
			let priceText = el ? el.innerText : null;

			// Availability: Check for "sold out" or "non disponibile"
			const btn = document.querySelector('.product-form__cart-submit');
			const btnText = btn ? btn.innerText.toLowerCase() : '';
			const available = !btnText.includes('esaurito') && !btnText.includes('sold out');

			// Title: Shopify product title
			const titleEl = document.querySelector('.product-single__title') || document.querySelector('h1.product__title') || document.querySelector('h1');
			const title = titleEl ? titleEl.textContent.trim() : null;

			// Image: Shopify product image
			const imgEl = document.querySelector('.product-single__photo img') || document.querySelector('.product__media img') || document.querySelector('.product-featured-img');
			const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null;

			// Description
			const descEl = document.querySelector('.product-single__description') || document.querySelector('.product__description') || document.querySelector('[data-product-description]');
			const description = descEl ? descEl.textContent.trim() : null;

			// Features: extract list items from description
			const featureEls = descEl ? descEl.querySelectorAll('li') : [];
			const features = Array.from(featureEls).map(li => li.textContent.trim()).filter(t => t.length > 0);

			return { priceText, available, title, image, description, features };
		});

		if (pageData.priceText) {
			// Regex to extract the last price occurrence (usually the discounted/current one)
			// Matches 949,00 or 1.099,00
			const matches = pageData.priceText.match(/[\d\.]+,[\d]{2}/g);
			if (matches && matches.length > 0) {
				data.price = matches[matches.length - 1];
			}
		}

		if (pageData.title) data.title = pageData.title;
		if (pageData.image) data.image = pageData.image;
		if (pageData.description) data.description = pageData.description;
		data.available = pageData.available;

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details };
	}
}

module.exports = ReworkLabsScraper;
