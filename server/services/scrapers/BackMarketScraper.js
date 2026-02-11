const BaseScraper = require('./BaseScraper');

class BackMarketScraper extends BaseScraper {
	async scrape(url) {
		const store = 'backmarket';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			let jsonLd = {};
			let nextData = {};

			// 1. Try JSON-LD
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

			// 2. Try NEXT_DATA (BackMarket often puts full state here)
			try {
				const nextScript = document.getElementById('__NEXT_DATA__');
				if (nextScript) {
					const json = JSON.parse(nextScript.innerText);
					// Navigate to product data in nextData structure (adjust path as needed based on inspection)
					// Common path: props.pageProps.product
					if (json.props && json.props.pageProps && json.props.pageProps.product) {
						nextData = json.props.pageProps.product;
					} else if (json.props && json.props.pageProps && json.props.pageProps.initialState && json.props.pageProps.initialState.product) {
						nextData = json.props.pageProps.initialState.product;
					}
				}
			} catch (e) { }

			// Data Extraction via DOM (Fallback/Complementary)
			const getText = (selector) => {
				const el = document.querySelector(selector);
				return el ? el.innerText.trim() : null;
			};

			// Check for Cloudflare/Bot Challenge
			if (document.title.includes('Just a moment') || document.title.includes('Challenge') || document.body.innerText.includes('Turnstile')) {
				return { isBlocked: true };
			}

			// Title
			let title = getText('[data-qa="product-title"]') || getText('h1');
			if (!title && nextData.title) title = nextData.title;

			// Price
			// Try to find the price in the main price box
			let price = getText('[data-qa="product-price"]');
			if (!price && jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// NEXT_DATA price fallback
			if (!price && nextData) {
				// Price might be in different fields depending on structure (e.g. price.amount)
				if (nextData.price && nextData.price.amount) price = nextData.price.amount;
			}

			// Availability
			// Check for "Add to cart" button presence and state
			const addToCartBtn = document.querySelector('[data-qa="add-to-cart-button"]');
			let available = !!addToCartBtn && !addToCartBtn.disabled;

			// Check for "Out of stock" indicators
			if (document.body.innerText.includes('Esaurito') || document.body.innerText.includes('Out of stock')) {
				available = false;
			}

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock');
				}
			}

			if (nextData && nextData.stock && nextData.stock.available !== undefined) {
				available = nextData.stock.available;
			}

			// Description
			let description = getText('[data-qa="product-description"]');
			if (!description) {
				const descEl = document.querySelector('#product-description'); // Fallback
				if (descEl) description = descEl.innerText.trim();
			}
			if (!description && jsonLd.description) description = jsonLd.description;
			if (!description && nextData.description) description = nextData.description;

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

			if (features.length === 0 && nextData.specifications) {
				// Assuming specifications is an array or object in NEXT_DATA
				if (Array.isArray(nextData.specifications)) {
					nextData.specifications.forEach(spec => features.push(`${spec.name}: ${spec.value}`));
				}
			}

			// Images
			// Usually grabbed by getGenericMetadata (og:image), but let's be specific
			let image = null;
			const imgEl = document.querySelector('img[data-qa="product-image"]');
			if (imgEl) image = imgEl.src;

			if (!image && jsonLd.image) {
				image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
			}
			if (!image && nextData.imageUrl) image = nextData.imageUrl;
			if (!image && nextData.images && nextData.images.length > 0) image = nextData.images[0];


			return { title, price, available, description, features, image, isBlocked: false };
		});

		if (pageData.isBlocked) {
			console.warn(`[BackMarketScraper] Blocked by anti-bot protection for URL: ${url}`);
			// Start interactive mode or return error? For now, let's return what we have (likely nothing correct) 
			// but maybe availabe = false helps trigger "check later".
			// Actually, if blocked, we should probably throw or return a specific error code if the system supports it.
			// For now, logging it is key.
		}

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
