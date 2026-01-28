const puppeteerCore = require('puppeteer-core');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const ScraperFactory = require('./scrapers/ScraperFactory');
const { userAgentManager } = require('../utils/userAgentManager');
const { createProxyManagerFromEnv } = require('../utils/proxyManager');
const { captchaDetector } = require('../utils/captchaDetector');

// Configuration
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES || '3', 10);
const RETRY_DELAY_BASE = parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10);

// Initialize proxy manager
const proxyManager = createProxyManagerFromEnv();
if (proxyManager.hasProxies()) {
	console.log(`[Scraper] Proxy manager initialized with ${proxyManager.getStats().total} proxies`);
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
	// Exponential backoff with jitter: base * 2^attempt + random jitter
	const exponentialDelay = RETRY_DELAY_BASE * Math.pow(2, attempt);
	const jitter = Math.random() * 1000; // 0-1 second jitter
	return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

/**
 * Create browser instance with optional proxy
 * @param {Object|null} proxy - Proxy configuration
 * @returns {Promise<Browser>}
 */
async function createBrowser(proxy = null) {
	const isProduction = process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.NETLIFY;

	if (isProduction) {
		const chromium = require('@sparticuz/chromium');
		const lambdaArgs = [
			...chromium.args,
			'--single-process',
			'--disable-dev-shm-usage',
			'--no-zygote',
			...(proxy ? proxyManager.getProxyArgs(proxy) : []),
		];

		return puppeteer.launch({
			args: lambdaArgs,
			defaultViewport: chromium.defaultViewport,
			executablePath: await chromium.executablePath(),
			headless: chromium.headless,
			ignoreHTTPSErrors: true,
		});
	} else {
		// Local Development
		const localExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

		return puppeteer.launch({
			channel: 'chrome',
			executablePath: localExecutablePath,
			headless: 'new',
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				...(proxy ? proxyManager.getProxyArgs(proxy) : []),
			]
		});
	}
}

/**
 * Scrape a product with retry logic
 * @param {string} url - URL to scrape
 * @param {number} attempt - Current attempt number (for internal use)
 * @returns {Promise<Object>} Scraped data
 */
async function scrapeProduct(url, attempt = 0) {
	let browser = null;
	const proxy = proxyManager.hasProxies() ? proxyManager.getRandomProxy() : null;

	try {
		// Get User-Agent for this request
		const userAgent = attempt === 0
			? userAgentManager.getUserAgentForUrl(url)
			: userAgentManager.getNextUserAgent(); // Use different UA on retry

		console.log(`[Scraper] Attempt ${attempt + 1}/${MAX_RETRIES} for ${url}`);
		console.log(`[Scraper] Using User-Agent: ${userAgent.substring(0, 50)}...`);
		if (proxy) {
			console.log(`[Scraper] Using proxy: ${proxy.server}`);
		}

		browser = await createBrowser(proxy);
		const page = await browser.newPage();
		await page.setViewport({ width: 1920, height: 1080 });

		// Authenticate proxy if needed
		if (proxy) {
			await proxyManager.authenticateProxy(page, proxy);
		}

		// Set rotating User-Agent
		await page.setUserAgent(userAgent);
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Cache-Control': 'no-cache',
			'Pragma': 'no-cache',
		});

		// Optimize performance by blocking unnecessary resources
		await page.setRequestInterception(true);
		page.on('request', (req) => {
			const resourceType = req.resourceType();
			if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
				req.abort();
			} else {
				req.continue();
			}
		});

		// Domain specific cookies
		const domain = new URL(url).hostname;
		await page.setCookie({
			name: 'session-id',
			value: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
			domain: domain
		});

		// Navigate with timeout handling
		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: 30000
			});
		} catch (navError) {
			if (navError.name !== 'TimeoutError') throw navError;
			console.warn(`[Scraper] Navigation timeout for ${url}, proceeding with partial load`);
		}

		// Enhanced CAPTCHA detection
		const captchaResult = await captchaDetector.detect(page);
		if (captchaResult.detected) {
			console.warn(`[Scraper] CAPTCHA detected (${captchaResult.type}), confidence: ${captchaResult.confidence}%`);

			// Mark proxy as potentially blocked
			if (proxy) {
				proxyManager.markCurrentAsFailed();
			}

			// Throw error to trigger retry with different UA/proxy
			if (attempt < MAX_RETRIES - 1) {
				throw new Error(`CAPTCHA_DETECTED:${captchaResult.type}`);
			}
		}

		// Use factory to get strategy
		const scraper = ScraperFactory.getScraper(url, page);
		const data = await scraper.scrape(url);

		// Fallback/Cleanup data if needed
		if (!data.title) data.title = await page.title();

		// Debug info
		data.debug = {
			url,
			strategy: scraper.constructor.name,
			foundPrice: !!data.price,
			attempt: attempt + 1,
			userAgent: userAgent.substring(0, 50),
			proxyUsed: !!proxy,
			captchaDetected: captchaResult.detected,
		};

		await browser.close();
		return data;

	} catch (error) {
		console.error(`[Scraper] Error on attempt ${attempt + 1}:`, error.message);

		// Close browser if open
		if (browser) {
			try {
				await browser.close();
			} catch (e) {
				// Ignore close errors
			}
		}

		// Check if we should retry
		const shouldRetry = attempt < MAX_RETRIES - 1 && (
			error.message.includes('CAPTCHA_DETECTED') ||
			error.message.includes('net::ERR_') ||
			error.message.includes('Protocol error') ||
			error.message.includes('Navigation timeout') ||
			error.name === 'TimeoutError'
		);

		if (shouldRetry) {
			const delay = getBackoffDelay(attempt);
			console.log(`[Scraper] Retrying in ${Math.round(delay / 1000)}s...`);
			await sleep(delay);
			return scrapeProduct(url, attempt + 1);
		}

		throw error;
	}
}

/**
 * Get scraper stats
 * @returns {Object}
 */
function getScraperStats() {
	return {
		captcha: captchaDetector.getStats(),
		proxy: proxyManager.getStats(),
		userAgentCount: userAgentManager.getAllUserAgents().length,
	};
}

module.exports = {
	scrapeProduct,
	getScraperStats,
};
