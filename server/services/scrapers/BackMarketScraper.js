const BaseScraper = require('./BaseScraper');

class BackMarketScraper extends BaseScraper {
	async scrape(url) {
		const store = 'backmarket';
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

			// Data Extraction via DOM (Fallback/Complementary)
			const getText = (selector) => {
				const el = document.querySelector(selector);
				return el ? el.innerText.trim() : null;
			};

			// Title
			let title = getText('[data-qa="product-title"]') || getText('h1');

			// Price
			// Try to find the price in the main price box
			let price = getText('[data-qa="product-price"]');
			if (!price && jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// Normalize price if found in DOM (e.g., "€ 259,00" -> "259.00")
			// We'll let the main logic handle the regex parsing, just return the raw string here if from DOM

			// Availability
			// Check for "Add to cart" button presence and state
			const addToCartBtn = document.querySelector('[data-qa="add-to-cart-button"]');
			let available = !!addToCartBtn && !addToCartBtn.disabled;

			// Check for "Out of stock" indicators
			if (document.body.innerText.includes('Esaurito') || document.body.innerText.includes('Out of stock')) {
				// Double check specific elements if possible, but button check is usually reliable
			}

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock');
				}
			}

			// Description
			let description = getText('[data-qa="product-description"]');
			if (!description) {
				const descEl = document.querySelector('#product-description'); // Fallback
				if (descEl) description = descEl.innerText.trim();
			}
			if (!description && jsonLd.description) description = jsonLd.description;
			if (description && description.length > 500) description = description.substring(0, 500) + '...';

			// Features / Specifications
			const features = [];
			// BackMarket often has a "Technical specifications" section
			const specItems = document.querySelectorAll('[data-qa="technical-specifications"] li, .technical-specifications li');
			specItems.forEach(item => {
				const text = item.innerText.trim();
				if (text) features.push(text);
			});

			// Should also check for key/value pairs if structured differently
			if (features.length === 0) {
				const specRows = document.querySelectorAll('dl.spec-list div'); // Example structure
				specRows.forEach(row => {
					const key = row.querySelector('dt');
					const val = row.querySelector('dd');
					if (key && val) {
						features.push(`${key.innerText.trim()}: ${val.innerText.trim()}`);
					}
				});
			}

			// Images
			// Usually grabbed by getGenericMetadata (og:image), but let's be specific
			let image = null;
			if (jsonLd.image) {
				image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
			}

			return { title, price, available, description, features, image };
		});

		// Post-processing
		if (pageData.title && (!data.title || data.title.length < pageData.title.length)) {
			data.title = pageData.title;
		}

		if (pageData.price) {
			// Regex to clean price: remove currency symbols, handle "1.234,56" vs "1234.56"
			// Backmarket IT usually shows "€ 259,00"
			let priceStr = pageData.price.toString().replace(/[^\d.,]/g, ''); // keep only numbers, dots, commas

			// Check format
			if (priceStr.includes(',') && priceStr.includes('.')) {
				// classic IT format 1.234,56 -> remove dot, replace comma with dot
				priceStr = priceStr.replace(/\./g, '').replace(',', '.');
			} else if (priceStr.includes(',')) {
				// 259,00 -> 259.00
				priceStr = priceStr.replace(',', '.');
			}

			const match = priceStr.match(/[\d\.]+/);
			if (match) {
				data.price = parseFloat(match[0]);
			}
		}

		// Availability logic
		if (pageData.available !== undefined) {
			data.available = pageData.available;
		}
		// Fallback: if we have a valid price, usually it's available (unless specific out of stock msg)
		if (data.available === undefined && data.price) {
			data.available = true;
		}

		if (pageData.description) {
			data.description = pageData.description;
		}

		if (pageData.image) {
			data.image = pageData.image;
		}

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details };
	}
}

module.exports = BackMarketScraper;
