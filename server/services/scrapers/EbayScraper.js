const BaseScraper = require('./BaseScraper');

class EbayScraper extends BaseScraper {
	async scrape(url) {
		const store = 'ebay';
		const data = await this.getGenericMetadata();

		const pageData = await this.page.evaluate(() => {
			// Title
			const titleEl = document.querySelector('.x-item-title__mainTitle') || document.querySelector('#itemTitle');
			const title = titleEl ? titleEl.textContent.replace('Details about', '').trim() : null;

			// Price
			const priceEl = document.querySelector('.x-price-primary') || document.querySelector('#prcIsum');
			const price = priceEl ? priceEl.textContent.trim() : null;

			// Image
			const imgEl = document.querySelector('.ux-image-carousel-item.image-treatment.active img') || document.querySelector('#icImg');
			const image = imgEl ? imgEl.src : null;

			// Description from item specifics
			const descEl = document.querySelector('#desc_div') || document.querySelector('.item-description');
			const description = descEl ? descEl.textContent.trim().substring(0, 500) : null;

			// Features: extract item specifics (key-value pairs displayed in a table)
			const features = [];

			// eBay item specifics table rows
			const specRows = document.querySelectorAll('.ux-labels-values__labels-content, .ux-labels-values');
			specRows.forEach(row => {
				const label = row.querySelector('.ux-labels-values__labels span.ux-textspans');
				const value = row.querySelector('.ux-labels-values__values span.ux-textspans');
				if (label && value) {
					const text = `${label.textContent.trim()}: ${value.textContent.trim()}`;
					if (text.length > 3) features.push(text);
				}
			});

			// Fallback: try the about-this-item section
			if (features.length === 0) {
				const aboutItems = document.querySelectorAll('.x-about-this-item .ux-textspans');
				aboutItems.forEach(el => {
					const text = el.textContent.trim();
					if (text.length > 3) features.push(text);
				});
			}

			// Availability
			const soldEl = document.querySelector('.d-quantity__availability .d-quantity__msg');
			const soldText = soldEl ? soldEl.textContent.toLowerCase() : '';
			const available = !soldText.includes('non disponibile') && !soldText.includes('sold out') && !soldText.includes('this item is out of stock');

			return { title, price, image, description, features, available };
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

module.exports = EbayScraper;
