const express = require('express');
const cors = require('cors');
const env = require('./config/env');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Trust first proxy (Netlify)


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

const { checkUrl } = require('./scrape/policy/urlPolicy');
const { normalizeScrapeResult } = require('./scrape/normalizeResult');

app.post('/api/scrape', scrapeLimiter, async (req, res) => {
	const { url } = req.body;

	try {
		// Nessuna whitelist: si verifica che l'URL sia sicuro da visitare,
		// non che il dominio sia in un elenco.
		const policy = await checkUrl(url);
		if (!policy.allowed) {
			return res.status(400).json({ error: `URL non ammesso: ${policy.reason}`, reason: policy.reason });
		}

		const data = await scrapeProduct(policy.url);
		res.json(normalizeScrapeResult(data, policy.url));
	} catch (error) {
		console.error('Scraping error:', error);
		res.status(500).json({ error: 'Failed to scrape product' });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
