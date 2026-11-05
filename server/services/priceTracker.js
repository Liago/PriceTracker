const { createJobQueue } = require('../scrape/jobs/queue');
const { normalizeUserSettings } = require('./userSettings');
const { requireResult } = require('./trackingRepository');

/** One scheduling path for local development, API requests and Netlify. */
async function enqueueDueChecks({ client, userId = null, trigger = 'scheduled' }) {
	const queue = createJobQueue({ client });
	const requeued = await queue.requeueStale();
	let query = client.from('products').select('*').or('monitoring_until.is.null,monitoring_until.gte.' + new Date().toISOString().slice(0, 10));
	if (userId) query = query.eq('user_id', userId);
	const products = requireResult(await query, 'Lettura prodotti');
	const settings = new Map();
	const intervalFor = async product => {
		if (!settings.has(product.user_id)) settings.set(product.user_id, normalizeUserSettings(requireResult(
			await client.from('user_settings').select('*').eq('user_id', product.user_id).maybeSingle(), 'Impostazioni utente')));
		return trigger === 'manual' ? 0 : settings.get(product.user_id).priceCheckIntervalMinutes;
	};
	const result = await queue.enqueueDue(products, intervalFor, { trigger });
	return { ...result, requeued, pending: await queue.pendingCount() };
}
async function checkProductPrices() {
	const { createClient } = require('@supabase/supabase-js');
	const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
	const queued = await enqueueDueChecks({ client });
	const result = await require('../../netlify/functions/worker').handler();
	if (result.statusCode !== 200) throw new Error('Lotto di controllo non completato');
	await require('./emailOutbox').deliverEmails(client);
	return { ...queued, ...JSON.parse(result.body) };
}
module.exports = { checkProductPrices, enqueueDueChecks };
