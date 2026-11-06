/**
 * Avvio firmato delle background function di Netlify.
 *
 * L'invocazione parte dalla stessa installazione verso se stessa: l'origine
 * viene dalle variabili che Netlify imposta, mai da header o input utente, e
 * il corpo e' firmato con la chiave di servizio, quindi una richiesta esterna
 * non puo' avviare lavoro.
 *
 * Non si richiede `NETLIFY=true`: e' garantita durante la build, non a runtime
 * dentro le function. Pretenderla bloccava ogni avvio - le aggiunte restavano
 * «pending» per sempre e il client attendeva fino al proprio timeout.
 */
const { createHmac, timingSafeEqual } = require('node:crypto');

function signature(body, env = process.env) {
	const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
	if (!key) throw new Error('Chiave del servizio non configurata');
	return createHmac('sha256', key).update(body).digest('hex');
}

/** L'origine del deployment corrente, come la fornisce Netlify. */
function deploymentOrigin(env = process.env) {
	return env.DEPLOY_PRIME_URL || env.URL || env.DEPLOY_URL || null;
}

/**
 * Avvia una background function. Netlify risponde 202 appena l'ha accodata:
 * qualunque altro stato significa che il lavoro non e' partito.
 */
async function invokeBackground(name, payload, { env = process.env, request = fetch, timeoutMs = 4000 } = {}) {
	const origin = deploymentOrigin(env);
	if (!origin) throw new Error('URL del deployment non configurato');
	const body = JSON.stringify({ ...payload, at: Date.now() });
	const response = await request(new URL(`/.netlify/functions/${name}`, origin), {
		method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Signature': signature(body, env) },
		body, signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status !== 202) throw new Error(`Avvio ${name}: HTTP ${response.status}`);
}

async function dispatchImport(id, options = {}) {
	return invokeBackground('product-import-background', { id }, options);
}

/** Verifica firma e freschezza. `requireId` e' falso per le invocazioni senza job specifico. */
function verifyInvocation(body, signed, env = process.env, { requireId = true } = {}) {
	try {
		if (typeof signed !== 'string' || !/^[a-f0-9]{64}$/.test(signed)) return null;
		if (!timingSafeEqual(Buffer.from(signature(body, env), 'hex'), Buffer.from(signed, 'hex'))) return null;
		const data = JSON.parse(body);
		if (requireId && typeof data.id !== 'string') return null;
		if (!Number.isFinite(data.at) || Math.abs(Date.now() - data.at) > 60000) return null;
		return data;
	} catch { return null; }
}

/** Corpo e firma di un evento Netlify, nella forma che verifyInvocation si aspetta. */
function readSignedEvent(event, options) {
	const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
	if (event.httpMethod !== 'POST') return null;
	return verifyInvocation(body, event.headers?.['x-import-signature'], process.env, options);
}

module.exports = { dispatchImport, invokeBackground, verifyInvocation, readSignedEvent, signature, deploymentOrigin };
