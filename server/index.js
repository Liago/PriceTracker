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

		const data = await page.evaluate(() => {
			const getMeta = (name) => {
				const element = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
				return element ? element.content : null;
			};

			const title = getMeta('og:title') || document.title;
			const image = getMeta('og:image');
			const description = getMeta('og:description');

			// Try to find price
			// This is very generic and might need site-specific selectors
			let price = getMeta('product:price:amount') || getMeta('og:price:amount');
			let currency = getMeta('product:price:currency') || getMeta('og:price:currency') || 'EUR';

			if (!price) {
				// Fallback: look for common price patterns in text
				const priceRegex = /[\$€£]\s*\d+([.,]\d{2})?|\d+([.,]\d{2})?\s*[\$€£]/;
				const elements = document.body.innerText.match(priceRegex);
				if (elements) {
					price = elements[0];
				}
			}

			return { title, image, description, price, currency };
		});

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
