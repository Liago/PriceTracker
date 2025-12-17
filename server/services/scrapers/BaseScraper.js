/**
 * Base Scraper Class
 * Defines the interface and common functionality for all scrapers.
 */
class BaseScraper {
	constructor(page) {
		this.page = page;
	}

	/**
	 * Main scrape method
	 * @param {string} url 
	 * @returns {Promise<Object>} Scraped data
	 */
	async scrape(url) {
		throw new Error('Method scrape() must be implemented');
	}

	/**
	 * Common helper to get meta tag content
	 * @param {string} name - property or name attribute value
	 * @returns {Promise<string|null>}
	 */
	async getMeta(name) {
		return this.page.evaluate((metaName) => {
			const element = document.querySelector(`meta[property="${metaName}"]`) || document.querySelector(`meta[name="${metaName}"]`);
			return element ? element.content : null;
		}, name);
	}

	/**
	 * Common helper to get generic metadata (OG tags)
	 * @returns {Promise<Object>}
	 */
	async getGenericMetadata() {
		const title = (await this.getMeta('og:title')) || (await this.page.title());
		const image = await this.getMeta('og:image');
		const description = await this.getMeta('og:description');
		const price = (await this.getMeta('product:price:amount')) || (await this.getMeta('og:price:amount'));
		const currency = (await this.getMeta('product:price:currency')) || (await this.getMeta('og:price:currency')) || 'EUR';

		return { title, image, description, price, currency };
	}
}

module.exports = BaseScraper;
