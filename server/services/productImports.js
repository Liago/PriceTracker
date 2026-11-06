const { randomUUID } = require('node:crypto');
const { requireResult } = require('./trackingRepository');
const { canonicalizeUrl } = require('../scrape/normalize/offer');

async function enqueueImport(client, userId, body) {
	const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
	let url;
	try {
		url = new URL(body.url);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid('URL non ammesso');
	} catch { invalid('URL non valido'); }
	const { targetPrice = null, monitoringUntil = null, requestId = randomUUID() } = body;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) invalid('Identificativo richiesta non valido');
	if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) invalid('Prezzo obiettivo non valido');
	if (monitoringUntil !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(monitoringUntil) || !Number.isFinite(Date.parse(monitoringUntil)))) invalid('Data non valida');
	return requireResult(await client.rpc('enqueue_product_import', { p_id: requestId, p_user_id: userId,
		p_request: { url: canonicalizeUrl(url.href), targetPrice, monitoringUntil } }), 'Accodamento prodotto');
}

async function processImport(client, jobId, dependencies = {}) {
	const job = requireResult(await client.rpc('claim_product_import', { p_id: jobId }), 'Claim aggiunta');
	if (!job) return;
	try {
		const { createProductRequest } = require('../api/routes');
		let status = 200, response;
		const res = { status(code) { status = code; return this; }, json(body) { response = body; return this; } };
		await createProductRequest({ client, user: { id: job.user_id }, body: job.request, ...dependencies,
			createProductImpl: async ({product, descriptor, observation}) => requireResult(await client.rpc('finish_product_import', {
				p_id: job.id, p_lease_id: job.lease_id, p_product: product, p_offer: descriptor, p_observation: observation,
			}), 'Completamento aggiunta') }, res);
		if (status !== 201) {
			requireResult(await client.from('product_import_jobs').update({ status: 'failed', error: { status, ...response }, updated_at: new Date().toISOString() })
				.eq('id', job.id).eq('lease_id', job.lease_id).eq('status', 'running'), 'Esito aggiunta');
		}
	} catch (error) {
		// Leave the lease recoverable if the database itself is unavailable.
		throw error;
	}
}

module.exports = { enqueueImport, processImport };
