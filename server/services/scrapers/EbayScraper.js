const BaseScraper = require('./BaseScraper');

class EbayScraper extends BaseScraper {
	async scrape(url) {
		const store = 'ebay';
		const data = await this.getGenericMetadata();

		// Refine Title
		const pageTitle = await this.page.evaluate(() => {
			const el = document.querySelector('.x-item-title__mainTitle') || document.querySelector('#itemTitle');
			return el ? el.textContent.replace('Details about', '').trim() : null;
		});
		if (pageTitle) data.title = pageTitle;

		// Refine Price
		const pagePrice = await this.page.evaluate(() => {
			const el = document.querySelector('.x-price-primary') || document.querySelector('#prcIsum');
			// eBay often puts currency symbol with price, e.g. "EUR 100,00" or "US $100.00"
			return el ? el.textContent.trim() : null;
		});
		if (pagePrice) data.price = pagePrice;

		// Images
		const pageImage = await this.page.evaluate(() => {
			const el = document.querySelector('.ux-image-carousel-item.image-treatment.active img') || document.querySelector('#icImg');
			return el ? el.src : null;
		});
		if (pageImage) data.image = pageImage;

		return { ...data, store };
	}
}

module.exports = EbayScraper;
