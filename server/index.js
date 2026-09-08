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

// Lo scheduler locale gira SOLO in sviluppo. In produzione il lavoro e'
// governato dalle funzioni schedulate di Netlify (dispatcher e worker): avere
// due scheduler con logiche diverse - node-cron ogni minuto qui, una function
// oraria la' - significava comportamenti diversi fra locale e produzione
// (difetto D10).
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
	const cronExpression = process.env.DEV_CRON || '*/5 * * * *';
	console.log(`[Server] Controllo prezzi in sviluppo: ${cronExpression}`);
	cron.schedule(cronExpression, () => {
		console.log('[Server] Controllo prezzi schedulato (sviluppo)');
		checkProductPrices();
	});
} else {
	console.log('[Server] Scheduler locale disattivato: in produzione decidono dispatcher e worker');
}

const { createClient } = require('@supabase/supabase-js');
const { registerRoutes } = require('./api/routes');

// Rate Limiting
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});

const scrapeLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 10,
	message: { error: 'Troppe richieste di analisi, riprova fra poco.' },
});

let adminClient = null;
function getClient() {
	if (!adminClient) {
		adminClient = createClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
		);
	}
	return adminClient;
}

const router = express.Router();
router.use(apiLimiter);
router.post('/scrape', scrapeLimiter);
registerRoutes({ getClient })(router);

// Innesco manuale del controllo, utile in sviluppo.
router.post('/check-prices', async (req, res) => {
	console.log('[Server] Controllo prezzi avviato a mano');
	checkProductPrices();
	res.json({ message: 'Controllo avviato in background' });
});

app.use('/api', router);

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
