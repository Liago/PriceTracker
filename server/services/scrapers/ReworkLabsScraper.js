const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class ReworkLabsScraper extends BaseScraper {
	async scrape(url) {
		const store = 'reworklabs';
		let html = '';

		// 1. Fetch HTML directly (Bypass Puppeteer for speed)
		try {
			console.log(`[ReworkLabs] Fetching URL: ${url}`);
			const response = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
			}

			html = await response.text();
		} catch (error) {
			console.error(`[ReworkLabs] Fetch failed: ${error.message}`);
			// Fallback: If fetch fails (e.g. strict bot protection), maybe use Puppeteer?
			// But user wants speed. Let's throw for now or try to use the puppeteer page if it was already loaded?
			// The factory passes 'page' to constructor. If we modify scrape() to bypass it, we save the launch time ONLY IF we don't launch browser.
			// BUT ScraperFactory ALREADY launched the browser before calling getScraper().
			// So the browser IS launched effectively.
			//
			// WAIT. `scraper.js` launches browser THEN calls `scraper.scrape()`.
			// So we are still paying the cost of launching browser.
			// HOWEVER, `page.goto` is the slow part (15s).
			// If we ignore `page` and use `fetch`, we save the 15s page load time.
			// The browser launch itself is usually fast-ish on Lambda (warm start) but `goto` is the killer.
			throw error;
		}

		// 2. Parse with Cheerio
		const $ = cheerio.load(html);
		const data = {};

		// Price
		let priceText = $('.product-price').first().text() ||
			$('.price').first().text() ||
			$('#ProductPrice-product-template').text();

		// Regex to extract price (last occurrence usually correct for discounts)
		if (priceText) {
			const matches = priceText.match(/[\d\.]+,[\d]{2}/g);
			if (matches && matches.length > 0) {
				data.price = matches[matches.length - 1];
			}
		}

		// Availability
		const btnText = $('.product-form__cart-submit').text().toLowerCase();
		data.available = !btnText.includes('esaurito') && !btnText.includes('sold out');

		// Title
		data.title = $('.product-single__title').text().trim() ||
			$('h1.product__title').text().trim() ||
			$('h1').first().text().trim();

		// Image
		const imgEl = $('.product-single__photo img').first() ||
			$('.product__media img').first() ||
			$('.product-featured-img');
		data.image = imgEl.attr('src') || imgEl.attr('data-src');
		if (data.image && data.image.startsWith('//')) data.image = 'https:' + data.image;

		// Description
		const richDescEl = $('.contenuto-descrizione');
		data.description = richDescEl.length ? richDescEl.text().trim() :
			($('.product-single__description').text().trim() ||
				$('.product__description').text().trim());

		// Features
		const features = [];
		if (richDescEl.length) {
			// Strategy 1: Find "Caratteristiche principali" header and get next UL
			richDescEl.find('h3, h4, strong').each((i, el) => {
				const text = $(el).text().toLowerCase();
				if (text.includes('caratteristiche')) {
					// Try to find the closest UL following this header
					const nextUl = $(el).nextAll('ul').first();
					if (nextUl.length) {
						nextUl.find('li').each((j, li) => {
							const feat = $(li).text().trim();
							if (feat) features.push(feat);
						});
					}
				}
			});

			// Fallback: Grab first UL if no features found yet
			if (features.length === 0) {
				const allLis = richDescEl.find('ul li');
				if (allLis.length > 0 && allLis.length < 20) {
					allLis.each((i, li) => features.push($(li).text().trim()));
				}
			}
		}

		// Fallback Strategy 2: Short description key-value pairs
		if (features.length === 0) {
			const shortDescText = $('.woocommerce-product-details__short-description p').text();
			if (shortDescText) {
				const parts = shortDescText.split(/[.,]\s+/);
				parts.forEach(currentPart => {
					if (currentPart.includes(':') && currentPart.trim().length > 3) {
						features.push(currentPart.trim());
					}
				});
			}
		}

		return {
			...data,
			store,
			details: { features }
		};
	}
}

module.exports = ReworkLabsScraper;
