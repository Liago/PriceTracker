/**
 * Dispatcher: accoda i prodotti dovuti, non li controlla.
 *
 * La separazione e' il punto. Prima il controllo era un ciclo sequenziale
 * dentro una singola invocazione, con una pausa fra un prodotto e l'altro: su
 * Netlify supera il timeout appena i prodotti crescono, e quelli in fondo alla
 * lista non venivano mai controllati (difetto D11). Il dispatcher fa solo
 * lavoro di database, quindi termina in fretta qualunque sia il numero di
 * prodotti; a controllarli sono i worker, ognuno entro il proprio budget.
 */

const { createClient } = require('@supabase/supabase-js');
const { createJobQueue } = require('../../server/scrape/jobs/queue');
const { normalizeUserSettings } = require('../../server/services/userSettings');

function adminClient() {
	return createClient(
		process.env.SUPABASE_URL,
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
	);
}

module.exports.handler = async () => {
	const startedAt = Date.now();
	const client = adminClient();
	const queue = createJobQueue({ client });

	try {
		// I job lasciati appesi da un worker morto tornano disponibili.
		const requeued = await queue.requeueStale();
		if (requeued > 0) console.log(`[Dispatcher] ${requeued} job rimessi in coda`);

		const { data: products, error } = await client
			.from('products')
			.select('id, url, user_id, last_checked_at, target_price, tracking_health, consecutive_failures, last_success_at')
			.or('monitoring_until.is.null,monitoring_until.gte.' + new Date().toISOString().split('T')[0]);

		if (error) throw new Error(`Lettura prodotti fallita: ${error.message}`);
		if (!products || products.length === 0) {
			return { statusCode: 200, body: JSON.stringify({ message: 'nessun prodotto attivo' }) };
		}

		// Le impostazioni si leggono una volta per utente, non una per prodotto.
		const settingsCache = new Map();
		const intervalResolver = async (product) => {
			if (!settingsCache.has(product.user_id)) {
				const { data } = await client
					.from('user_settings').select('*').eq('user_id', product.user_id).maybeSingle();
				settingsCache.set(product.user_id, normalizeUserSettings(data));
			}
			return settingsCache.get(product.user_id).priceCheckIntervalMinutes;
		};

		const { enqueued, skipped } = await queue.enqueueDue(products, intervalResolver);
		const pending = await queue.pendingCount();

		console.log(`[Dispatcher] ${enqueued} accodati, ${skipped} non dovuti, ${pending} in attesa`);

		return {
			statusCode: 200,
			body: JSON.stringify({ enqueued, skipped, pending, requeued, durationMs: Date.now() - startedAt }),
		};
	} catch (error) {
		console.error('[Dispatcher] Errore:', error.message);
		return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
	}
};
