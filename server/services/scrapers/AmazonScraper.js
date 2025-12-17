const BaseScraper = require('./BaseScraper');

class AmazonScraper extends BaseScraper {
	async scrape(url) {
		const store = 'amazon';

		// 1. Title Extraction
		let title = await this.getMeta('og:title') || await this.page.title();

		// Improve title using page context
		const pageTitle = await this.page.evaluate(() => {
			const el = document.querySelector('#productTitle');
			return el ? el.textContent.trim() : null;
		});

		if (pageTitle) {
			title = pageTitle;
		} else {
			title = title.replace(/\s*:\s*Amazon\.(it|com|co\.uk|de|fr|es).*$/i, '');
		}

		// 2. Image Extraction
		let image = await this.getMeta('og:image');
		if (!image) {
			image = await this.page.evaluate(() => {
				const imgElement = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront');
				if (imgElement) {
					let src = imgElement.src || imgElement.getAttribute('data-old-hires') || imgElement.getAttribute('data-a-dynamic-image');
					if (src && src.startsWith('{')) {
						try {
							const imgData = JSON.parse(src);
							return Object.keys(imgData)[0];
						} catch (e) { return null; }
					}
					return src;
				}
				return null;
			});
		}

		// 3. Description Extraction
		let description = await this.getMeta('og:description');
		const features = await this.page.evaluate(() => {
			return Array.from(document.querySelectorAll('#feature-bullets li span.a-list-item'))
				.map(el => el.textContent.trim())
				.filter(text => text.length > 0);
		});

		let details = {};
		if (features.length > 0) {
			details.features = features;
			if (!description || description.length < 50) {
				description = features.slice(0, 3).join('\n');
			}
		}

		// 4. Price & Availability
		let price = await this.getMeta('product:price:amount') || await this.getMeta('og:price:amount');
		let currency = await this.getMeta('product:price:currency') || await this.getMeta('og:price:currency') || 'EUR';
		let available = true;

		// Check availability first
		const availabilityInfo = await this.page.evaluate(() => {
			const el = document.querySelector('#availability');
			const text = el ? el.innerText.toLowerCase() : '';
			const bodyText = document.body.innerText.toLowerCase();
			return {
				text,
				bodyHasUnavailable: bodyText.includes('non disponibile') || bodyText.includes('currently unavailable') || bodyText.includes('out of stock')
			};
		});

		if (availabilityInfo.text.includes('non disponibile') ||
			availabilityInfo.text.includes('currently unavailable') ||
			availabilityInfo.text.includes('out of stock')) {
			available = false;
		}

		// Price selectors strategy for Amazon
		if (!price) {
			price = await this.page.evaluate(() => {
				const selectors = [
					'.a-price .a-offscreen',
					'#priceblock_ourprice',
					'#priceblock_dealprice',
					'.a-price-whole',
					'#corePrice_feature_div .a-price .a-offscreen',
					'#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
					'#corePrice_desktop .a-price .a-offscreen',
					'.apexPriceToPay .a-offscreen',
					'.priceToPay .a-offscreen',
					'#apex_desktop .a-price .a-offscreen'
				];
				for (const sel of selectors) {
					const el = document.querySelector(sel);
					if (el) return el.textContent.trim();
				}
				return null;
			});
		}

		// Final check: if no price and "currently unavailable" in body, it's unavailable
		if (!price && availabilityInfo.bodyHasUnavailable) {
			// Double check if availability element confirmed it
			// Or just assume unavailable if we really can't find a price
			available = false;
		} else if (!price && !available) {
			// Consistent
		} else if (!price) {
			// If still no price, try JSON-LD (common fallback) inside evaluate context or here
			// We implement a simplified fallback logic or rely on main controller fallback if we return null
			available = false; // Assume unavailable if price missing on Amazon
		}

		return { title, image, description, price, currency, store, details, available };
	}
}

module.exports = AmazonScraper;
