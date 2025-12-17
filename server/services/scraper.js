const puppeteer = require('puppeteer-core');
const ScraperFactory = require('./scrapers/ScraperFactory');

async function scrapeProduct(url) {
	try {
		let browser;

		// Check if running on Netlify/Lambda
		const isProduction = process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.NETLIFY;

		if (isProduction) {
			const chromium = require('@sparticuz/chromium');
			const lambdaArgs = [
				...chromium.args,
				'--single-process',
				'--disable-dev-shm-usage',
				'--no-zygote',
			];

			browser = await puppeteer.launch({
				args: lambdaArgs,
				defaultViewport: chromium.defaultViewport,
				executablePath: await chromium.executablePath(),
				headless: chromium.headless,
				ignoreHTTPSErrors: true,
			});
		} else {
			// Local Development
			const localExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

			browser = await puppeteer.launch({
				channel: 'chrome',
				executablePath: localExecutablePath,
				headless: 'new',
				args: ['--no-sandbox', '--disable-setuid-sandbox']
			});
		}

		const page = await browser.newPage();
		await page.setViewport({ width: 1920, height: 1080 });

		// Anti-blocking headers
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
		});

		// Domain specific cookies (e.g. for Amazon session)
		const domain = new URL(url).hostname;
		await page.setCookie({
			name: 'session-id',
			value: '000-0000000-0000000',
			domain: domain
		});

		await page.goto(url, {
			waitUntil: 'domcontentloaded',
			timeout: 30000
		});

		await new Promise(resolve => setTimeout(resolve, 3000));

		// USE FACTORY TO GET STRATEGY
		const scraper = ScraperFactory.getScraper(url, page);
		const data = await scraper.scrape(url);

		// Fallback/Cleanup data if needed
		if (!data.title) data.title = await page.title();

		// Common post-processing or debug info
		data.debug = {
			url,
			strategy: scraper.constructor.name,
			foundPrice: !!data.price
		};

		await browser.close();
		return data;
	} catch (error) {
		console.error('Scraping error:', error);
		throw error;
	}
}

module.exports = { scrapeProduct };
