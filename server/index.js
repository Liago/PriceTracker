const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
	res.send('Price Tracker API is running');
});

const puppeteer = require('puppeteer');
const cron = require('node-cron');
const { checkProductPrices } = require('./services/priceTracker');

// Price tracking cron job
const priceCheckInterval = process.env.PRICE_CHECK_INTERVAL || '6'; // hours
const cronExpression = `0 */${priceCheckInterval} * * *`; // Every N hours

console.log(`[Server] Price tracking cron scheduled: every ${priceCheckInterval} hours`);

cron.schedule(cronExpression, () => {
	console.log('[Server] Running scheduled price check...');
	checkProductPrices();
});

// Optional: Run on startup (commented out by default)
// setTimeout(() => {
//   console.log('[Server] Running initial price check...');
//   checkProductPrices();
// }, 5000);

// Manual trigger endpoint (optional, useful for testing)
app.post('/api/check-prices', async (req, res) => {
	console.log('[Server] Manual price check triggered');
	checkProductPrices();
	res.json({ message: 'Price check started in background' });
});

app.post('/api/scrape', async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({ error: 'URL is required' });
	}

	try {
		const browser = await puppeteer.launch({
			headless: 'new',
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});
		const page = await browser.newPage();

		// Set user agent to avoid being blocked
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const data = await page.evaluate((url) => {
			const getMeta = (name) => {
				const element = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
				return element ? element.content : null;
			};

			const isAmazon = url.includes('amazon.');

			// Title extraction
			let title = getMeta('og:title') || document.title;

			if (isAmazon) {
				// Amazon-specific title cleanup
				const titleElement = document.querySelector('#productTitle');
				if (titleElement) {
					title = titleElement.textContent.trim();
				} else {
					// Clean up Amazon suffixes from page title
					title = title.replace(/\s*:\s*Amazon\.(it|com|co\.uk|de|fr|es).*$/i, '');
				}
			}

			// Image extraction
			let image = getMeta('og:image');

			if (isAmazon && !image) {
				// Try Amazon-specific image selectors
				const imgElement = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront');
				if (imgElement) {
					image = imgElement.src || imgElement.getAttribute('data-old-hires') || imgElement.getAttribute('data-a-dynamic-image');
					// Parse dynamic image JSON if needed
					if (image && image.startsWith('{')) {
						try {
							const imgData = JSON.parse(image);
							image = Object.keys(imgData)[0];
						} catch (e) {
							image = null;
						}
					}
				}
			}

			// Description
			const description = getMeta('og:description');

			// Price extraction
			let price = getMeta('product:price:amount') || getMeta('og:price:amount');
			let currency = getMeta('product:price:currency') || getMeta('og:price:currency') || 'EUR';

			if (isAmazon && !price) {
				// Amazon-specific price selectors
				const priceSelectors = [
					'.a-price .a-offscreen',
					'#priceblock_ourprice',
					'#priceblock_dealprice',
					'.a-price-whole',
					'#corePrice_feature_div .a-price .a-offscreen'
				];

				for (const selector of priceSelectors) {
					const priceElement = document.querySelector(selector);
					if (priceElement) {
						price = priceElement.textContent.trim();
						break;
					}
				}
			}

			if (!price) {
				// Fallback: look for common price patterns in text
				const priceRegex = /[\$€£]\s*\d+([.,]\d{2,3})?|\d+([.,]\d{2,3})?\s*[\$€£]/;
				const elements = document.body.innerText.match(priceRegex);
				if (elements) {
					price = elements[0];
				}
			}

			return { title, image, description, price, currency };
		}, url);

		await browser.close();
		res.json(data);
	} catch (error) {
		console.error('Scraping error:', error);
		res.status(500).json({ error: 'Failed to scrape product' });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
