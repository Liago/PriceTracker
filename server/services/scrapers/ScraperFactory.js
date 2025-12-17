const AmazonScraper = require('./AmazonScraper');
const SwappieScraper = require('./SwappieScraper');
const BaseScraper = require('./BaseScraper');

class ScraperFactory {
	static getScraper(url, page) {
		const hostname = new URL(url).hostname;

		if (hostname.includes('amazon.')) {
			return new AmazonScraper(page);
		} else if (hostname.includes('swappie.com')) {
			return new SwappieScraper(page);
		} else {
			return new BaseScraper(page);
		}
	}
}

module.exports = ScraperFactory;
