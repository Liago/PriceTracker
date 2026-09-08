/**
 * API su Netlify Functions.
 *
 * Le route sono definite una volta sola in server/api/routes.js e montate qui
 * e nel server Express: finora esistevano due copie della stessa logica, con
 * comportamenti diversi.
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const serverless = require('serverless-http');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { registerRoutes } = require('../../server/api/routes');
const { checkProductPrices } = require('../../server/services/priceTracker');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Price Tracker API'));

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});

const scrapeLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
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

router.post('/check-prices', async (req, res) => {
	try {
		await checkProductPrices();
		res.json({ message: 'Controllo completato' });
	} catch (error) {
		console.error('[API] Controllo prezzi fallito:', error.message);
		res.status(500).json({ error: 'Controllo prezzi fallito' });
	}
});

// Montato su entrambi i percorsi: la riscrittura di Netlify usa /api, ma la
// function e' raggiungibile anche direttamente.
app.use('/api', router);
app.use('/.netlify/functions/api', router);

module.exports.handler = serverless(app);
