const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const serverless = require('serverless-http');
const { scrapeProduct } = require('../../server/services/scraper');
const { checkProductPrices } = require('../../server/services/priceTracker');
const { validateProductUrl } = require('../../server/utils/validation');

dotenv.config();

const app = express();
const router = express.Router();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
	res.send('Price Tracker API (Netlify Functions)');
});

// Rate Limiting
const rateLimit = require('express-rate-limit');

// General API limiter
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	standardHeaders: true,
	legacyHeaders: false,
});

// Scraper limiter (stricter)
const scrapeLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: 10, // Limit each IP to 10 requests per minute
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: 'Too many scraping requests, please try again later.' }
});

app.use('/api', apiLimiter);
app.use('/.netlify/functions/api', apiLimiter);

// Scrape endpoint
router.post('/scrape', scrapeLimiter, async (req, res) => {
	console.log('[Debug] Request Headers:', JSON.stringify(req.headers));
	console.log('[Debug] Request Body Type:', typeof req.body);
	console.log('[Debug] Request Body:', JSON.stringify(req.body));

	let { url } = req.body;

	// Handle Buffer body (Netlify/Serverless specific)
	if (Buffer.isBuffer(req.body)) {
		try {
			const text = req.body.toString('utf-8');
			console.log('[Debug] Converted raw Buffer to string:', text);
			const parsed = JSON.parse(text);
			url = parsed.url;
		} catch (e) {
			console.error('[Debug] Raw Buffer conversion failed:', e);
		}
	} else if (req.body && req.body.type === 'Buffer' && Array.isArray(req.body.data)) {
		// Handle JSON-serialized Buffer (e.g. from JSON.stringify)
		try {
			const buffer = Buffer.from(req.body.data);
			const text = buffer.toString('utf-8');
			console.log('[Debug] Converted serialized Buffer to string:', text);
			const parsed = JSON.parse(text);
			url = parsed.url;
		} catch (e) {
			console.error('[Debug] Serialized Buffer conversion failed:', e);
		}
	}

	// Fallback: If express.json() didn't work and body is a string
	if (!url && typeof req.body === 'string') {
		try {
			const parsed = JSON.parse(req.body);
			url = parsed.url;
			console.log('[Debug] Manually parsed body:', parsed);
		} catch (e) {
			console.error('[Debug] Manual JSON parse failed:', e);
		}
	}

	if (!url) {
		return res.status(400).json({
			error: 'URL is required',
			debug: {
				bodyType: typeof req.body,
				bodyReceived: req.body
			}
		});
	}

	try {
		const validUrl = await validateProductUrl(url);
		const data = await scrapeProduct(validUrl);
		res.json(data);
	} catch (error) {
		if (error.message.includes('URL') || error.message.includes('Domain')) {
			console.warn('[Validation Error] Request rejected:', error.message);
			return res.status(400).json({ error: error.message });
		}
		console.error('Scraping error:', error);
		res.status(500).json({ error: 'Failed to scrape product' });
	}
});

// Manual check endpoint
router.post('/check-prices', async (req, res) => {
	try {
		await checkProductPrices();
		res.json({ message: 'Price check completed' });
	} catch (error) {
		console.error('Price check error:', error);
		res.status(500).json({ error: 'Price check failed' });
	}
});

// Mount router at /api (for local/rewrite) and /.netlify/functions/api (for direct access)
app.use('/api', router);
app.use('/.netlify/functions/api', router);

// Export the handler
module.exports.handler = serverless(app);
