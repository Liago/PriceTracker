const BaseScraper = require('./BaseScraper');

class UnieuroScraper extends BaseScraper {
	async scrape(url) {
		const store = 'unieuro';
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

			// Title
			const titleEl = document.querySelector('h1[class*="product-title"]') ||
				document.querySelector('h1[data-testid="product-title"]') ||
				document.querySelector('.product-detail__title') ||
				document.querySelector('h1');
			const title = titleEl ? titleEl.textContent.trim() : (jsonLd.name || null);

			// Price - Unieuro uses various selectors
			let price = null;
			const priceEl = document.querySelector('[data-testid="product-price"]') ||
				document.querySelector('.product-price__current') ||
				document.querySelector('.price-current') ||
				document.querySelector('[class*="price"] [class*="current"]') ||
				document.querySelector('[itemprop="price"]');

			if (priceEl) {
				price = priceEl.textContent || priceEl.getAttribute('content');
			} else if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// Image
			const imgEl = document.querySelector('.product-gallery__main img') ||
				document.querySelector('[data-testid="product-image"] img') ||
				document.querySelector('.product-image img') ||
				document.querySelector('[itemprop="image"]');
			let image = null;
			if (imgEl) {
				image = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('content');
			} else if (jsonLd.image) {
				image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
			}

			// Availability
			let available = true;
			const addToCartBtn = document.querySelector('[data-testid="add-to-cart"]') ||
				document.querySelector('.add-to-cart-button') ||
				document.querySelector('button[class*="add-to-cart"]');

			if (addToCartBtn) {
				available = !addToCartBtn.disabled && !addToCartBtn.classList.contains('disabled');
			}

			const unavailableEl = document.querySelector('.product-availability--unavailable') ||
				document.querySelector('[class*="out-of-stock"]');
			if (unavailableEl) available = false;

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock') || offer.availability.includes('PreOrder');
				}
			}

			// Features/Specifications
			const features = [];
			const specRows = document.querySelectorAll('.product-specs tr, .product-specifications tr, [class*="specification"] tr, [class*="tech-specs"] li');
			specRows.forEach(row => {
				const label = row.querySelector('td:first-child, th, .spec-label');
				const value = row.querySelector('td:last-child, .spec-value');
				if (label && value && label !== value) {
					const text = `${label.textContent.trim()}: ${value.textContent.trim()}`;
					if (text.length > 3 && text.length < 200) features.push(text);
				}
			});

			// Try bullet-point highlights
			if (features.length === 0) {
				const bullets = document.querySelectorAll('.product-highlights li, [class*="feature"] li, [class*="highlight"] li');
				bullets.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 2 && text.length < 200) features.push(text);
				});
			}

			// Description
			const descEl = document.querySelector('.product-description') ||
				document.querySelector('[itemprop="description"]') ||
				document.querySelector('[data-testid="product-description"]');
			let description = descEl ? descEl.textContent.trim().substring(0, 500) : null;
			if (!description && jsonLd.description) description = jsonLd.description.substring(0, 500);

			return { title, price, image, available, features, description };
		});

		if (pageData.title) data.title = pageData.title;
		if (pageData.price) data.price = pageData.price;
		if (pageData.image) data.image = pageData.image;
		if (pageData.description && (!data.description || data.description.length < 50)) {
			data.description = pageData.description;
		}

		let details = {};
		if (pageData.features && pageData.features.length > 0) {
			details.features = pageData.features;
		}

		return { ...data, store, details, available: pageData.available };
	}
}

module.exports = UnieuroScraper;
