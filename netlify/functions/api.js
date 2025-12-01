const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const serverless = require('serverless-http');
const { scrapeProduct } = require('../../server/services/scraper');
const { checkProductPrices } = require('../../server/services/priceTracker');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
	res.send('Price Tracker API (Netlify Functions)');
});

// Scrape endpoint
app.post('/scrape', async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({ error: 'URL is required' });
	}

	try {
		const data = await scrapeProduct(url);
		res.json(data);
	} catch (error) {
		console.error('Scraping error:', error);
		res.status(500).json({ error: 'Failed to scrape product' });
	}
});

// Manual check endpoint
app.post('/check-prices', async (req, res) => {
	try {
		await checkProductPrices();
		res.json({ message: 'Price check completed' });
	} catch (error) {
		console.error('Price check error:', error);
		res.status(500).json({ error: 'Price check failed' });
	}
});

// Export the handler
module.exports.handler = serverless(app);
