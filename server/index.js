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
// Price tracking cron job
// Run every minute to check if any product needs updating based on user settings
const cronExpression = '* * * * *';

console.log(`[Server] Price tracking cron scheduled: ${cronExpression} (every minute)`);

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

const { scrapeProduct } = require('./services/scraper');

app.post('/api/scrape', async (req, res) => {
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

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
