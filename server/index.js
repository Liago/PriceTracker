const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const allowedOrigins = [
	'http://localhost:5173', // Vite client
	'http://localhost:3000', // Self
	process.env.CLIENT_URL   // Production client URL
].filter(Boolean);

app.use(cors({
	origin: function (origin, callback) {
		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) return callback(null, true);

		if (allowedOrigins.indexOf(origin) === -1) {
			const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
			return callback(new Error(msg), false);
		}
		return callback(null, true);
	},
	credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
	res.send('Price Tracker API is running');
});


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

// Rate Limiting
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});

const scrapeLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: 10,
	message: { error: 'Too many scraping requests, please try again later.' }
});

app.use('/api', apiLimiter);

const { scrapeProduct } = require('./services/scraper');

const { validateProductUrl } = require('./utils/validation');

app.post('/api/scrape', scrapeLimiter, async (req, res) => {
	const { url } = req.body;

	try {
		const validUrl = await validateProductUrl(url);
		const data = await scrapeProduct(validUrl);
		res.json(data);
	} catch (error) {
		if (error.message.includes('URL') || error.message.includes('Domain')) {
			return res.status(400).json({ error: error.message });
		}
		console.error('Scraping error:', error);
		res.status(500).json({ error: 'Failed to scrape product' });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
