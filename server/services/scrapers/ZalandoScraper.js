const BaseScraper = require('./BaseScraper');

class ZalandoScraper extends BaseScraper {
	async scrape(url) {
		const store = 'zalando';
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

			// Title - Zalando uses specific structure
			const titleEl = document.querySelector('h1[class*="ProductTitle"]') ||
				document.querySelector('[data-testid="product-name"]') ||
				document.querySelector('h1[class*="product-name"]') ||
				document.querySelector('h1');
			const title = titleEl ? titleEl.textContent.trim() : (jsonLd.name || null);

			// Price - Zalando shows both original and promotional prices
			let price = null;
			// Look for current/sale price first
			const salePriceEl = document.querySelector('[class*="PromotionalPrice"]') ||
				document.querySelector('[data-testid="pdp-price-sale"]') ||
				document.querySelector('[class*="sale-price"]');
			const regularPriceEl = document.querySelector('[class*="OriginalPrice"]') ||
				document.querySelector('[data-testid="pdp-price-original"]') ||
				document.querySelector('[class*="regular-price"]');
			const priceEl = document.querySelector('[class*="ProductPrice"]') ||
				document.querySelector('[data-testid="pdp-price"]') ||
				document.querySelector('[itemprop="price"]');

			if (salePriceEl) {
				price = salePriceEl.textContent.trim();
			} else if (priceEl) {
				price = priceEl.textContent || priceEl.getAttribute('content');
			} else if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.price) price = offer.price;
			}

			// Image
			const imgEl = document.querySelector('[class*="ProductGallery"] img') ||
				document.querySelector('[data-testid="pdp-image"] img') ||
				document.querySelector('.product-media img') ||
				document.querySelector('[itemprop="image"]');
			let image = null;
			if (imgEl) {
				image = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('content');
			} else if (jsonLd.image) {
				image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
			}

			// Brand
			const brandEl = document.querySelector('[class*="BrandName"]') ||
				document.querySelector('[data-testid="brand-name"]');
			const brand = brandEl ? brandEl.textContent.trim() : (jsonLd.brand?.name || null);

			// Availability - Zalando shows size-based availability
			let available = true;
			const soldOutEl = document.querySelector('[class*="SoldOut"]') ||
				document.querySelector('[data-testid="sold-out-label"]') ||
				document.querySelector('[class*="out-of-stock"]');
			if (soldOutEl) available = false;

			// Check if add to cart exists
			const addToCartBtn = document.querySelector('[class*="AddToCart"]') ||
				document.querySelector('[data-testid="add-to-cart-button"]');
			if (addToCartBtn && addToCartBtn.disabled) available = false;

			if (jsonLd.offers) {
				const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
				if (offer.availability) {
					available = offer.availability.includes('InStock') || offer.availability.includes('PreOrder');
				}
			}

			// Available sizes
			const sizes = [];
			const sizeEls = document.querySelectorAll('[class*="SizeSelector"] button:not([disabled]), [data-testid="size-button"]:not([disabled])');
			sizeEls.forEach(el => {
				const size = el.textContent.trim();
				if (size) sizes.push(size);
			});

			// Features - clothing details
			const features = [];
			const detailItems = document.querySelectorAll('[class*="ProductDetail"] li, [data-testid="product-details"] li, .product-attributes li');
			detailItems.forEach(el => {
				const text = el.textContent.trim();
				if (text.length > 2 && text.length < 200) features.push(text);
			});

			// Description
			const descEl = document.querySelector('[class*="ProductDescription"]') ||
				document.querySelector('[data-testid="product-description"]') ||
				document.querySelector('[itemprop="description"]');
			let description = descEl ? descEl.textContent.trim().substring(0, 500) : null;
			if (!description && jsonLd.description) description = jsonLd.description.substring(0, 500);

			return { title, price, image, available, features, description, brand, sizes };
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
		if (pageData.brand) {
			details.brand = pageData.brand;
		}
		if (pageData.sizes && pageData.sizes.length > 0) {
			details.availableSizes = pageData.sizes;
		}

		return { ...data, store, details, available: pageData.available };
	}
}

module.exports = ZalandoScraper;
