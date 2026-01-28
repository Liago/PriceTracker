const BaseScraper = require('./BaseScraper');

class AliExpressScraper extends BaseScraper {
	async scrape(url) {
		const store = 'aliexpress';
		const data = await this.getGenericMetadata();

		// AliExpress uses heavy JavaScript, wait for content to load
		try {
			await this.page.waitForSelector('[class*="price"], [class*="Price"]', { timeout: 10000 });
		} catch (e) {
			// Continue anyway, might have loaded differently
		}

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
			const titleEl = document.querySelector('h1[data-pl="product-title"]') ||
				document.querySelector('.product-title-text') ||
				document.querySelector('h1[class*="ProductTitle"]') ||
				document.querySelector('[class*="title--wrap"] h1') ||
				document.querySelector('h1');
			const title = titleEl ? titleEl.textContent.trim() : (jsonLd.name || null);

			// Price - AliExpress has complex pricing structures
			let price = null;
			// Current/sale price selectors
			const priceEl = document.querySelector('[class*="product-price-value"]') ||
				document.querySelector('[class*="uniform-banner-box-price"]') ||
				document.querySelector('.product-price-current') ||
				document.querySelector('[data-pl="product-price"]') ||
				document.querySelector('[class*="Price"] [class*="current"]') ||
				document.querySelector('[itemprop="price"]');

			if (priceEl) {
				price = priceEl.textContent.trim();
			} else if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// Image - AliExpress uses lazy loading
			const imgEl = document.querySelector('.pdp-image-view img') ||
				document.querySelector('[class*="slider--img"]') ||
				document.querySelector('.product-image img') ||
				document.querySelector('[class*="gallery"] img') ||
				document.querySelector('[itemprop="image"]');
			let image = null;
			if (imgEl) {
				image = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('content');
				// AliExpress often uses small thumbnails, try to get larger version
				if (image && image.includes('_')) {
					image = image.replace(/_\d+x\d+/, '');
				}
			} else if (jsonLd.image) {
				image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
			}

			// Seller/Store info
			const storeEl = document.querySelector('[class*="store-name"]') ||
				document.querySelector('[data-pl="store-name"]');
			const seller = storeEl ? storeEl.textContent.trim() : null;

			// Availability
			let available = true;
			const soldOutEl = document.querySelector('[class*="soldout"]') ||
				document.querySelector('[class*="SoldOut"]') ||
				document.querySelector('.product-no-stock');
			if (soldOutEl) available = false;

			const addToCartBtn = document.querySelector('[data-pl="add-to-cart"]') ||
				document.querySelector('[class*="addToCart"]') ||
				document.querySelector('button[class*="add-to-cart"]');
			if (addToCartBtn && addToCartBtn.disabled) available = false;

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock') || offer.availability.includes('PreOrder');
				}
			}

			// Shipping info
			const shippingEl = document.querySelector('[class*="shipping-value"]') ||
				document.querySelector('[data-pl="shipping-cost"]');
			const shipping = shippingEl ? shippingEl.textContent.trim() : null;

			// Ratings
			const ratingEl = document.querySelector('[class*="review--rating"]') ||
				document.querySelector('[itemprop="ratingValue"]');
			const rating = ratingEl ? ratingEl.textContent.trim() : null;

			// Features/Specifications
			const features = [];
			const specRows = document.querySelectorAll('.product-property-list li, [class*="specifications"] tr, [class*="detail-list"] li');
			specRows.forEach(row => {
				const text = row.textContent.trim().replace(/\s+/g, ' ');
				if (text.length > 3 && text.length < 200) features.push(text);
			});

			// Description
			const descEl = document.querySelector('.product-description') ||
				document.querySelector('[class*="Description"]') ||
				document.querySelector('[itemprop="description"]');
			let description = descEl ? descEl.textContent.trim().substring(0, 500) : null;
			if (!description && jsonLd.description) description = jsonLd.description.substring(0, 500);

			return { title, price, image, available, features, description, seller, shipping, rating };
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
		if (pageData.seller) {
			details.seller = pageData.seller;
		}
		if (pageData.shipping) {
			details.shipping = pageData.shipping;
		}
		if (pageData.rating) {
			details.rating = pageData.rating;
		}

		return { ...data, store, details, available: pageData.available };
	}
}

module.exports = AliExpressScraper;
