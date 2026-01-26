const AmazonScraper = require('./AmazonScraper');
const SwappieScraper = require('./SwappieScraper');
const EbayScraper = require('./EbayScraper');
const MediaWorldScraper = require('./MediaWorldScraper');
const ReworkLabsScraper = require('./ReworkLabsScraper');
const RefurbedScraper = require('./RefurbedScraper');
const SmartGenerationScraper = require('./SmartGenerationScraper');
const JuiceScraper = require('./JuiceScraper');
const BaseScraper = require('./BaseScraper');

class ScraperFactory {
	static getScraper(url, page) {
		const hostname = new URL(url).hostname;

		if (hostname.includes('amazon.')) {
			return new AmazonScraper(page);
		} else if (hostname.includes('swappie.com')) {
			return new SwappieScraper(page);
		} else if (hostname.includes('ebay.')) {
			return new EbayScraper(page);
		} else if (hostname.includes('mediaworld.it')) {
			return new MediaWorldScraper(page);
		} else if (hostname.includes('rework-labs.com')) {
			return new ReworkLabsScraper(page);
		} else if (hostname.includes('refurbed.')) {
			return new RefurbedScraper(page);
		} else if (hostname.includes('smartgeneration.it')) {
			return new SmartGenerationScraper(page);
		} else if (hostname.includes('juice.it')) {
			return new JuiceScraper(page);
		} else {
			return new BaseScraper(page);
		}
	}
}

module.exports = ScraperFactory;
