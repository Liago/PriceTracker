const { createHmac, timingSafeEqual } = require('node:crypto');
function signature(body, env = process.env) {
	const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
	if (!key) throw new Error('Chiave del servizio non configurata');
	return createHmac('sha256', key).update(body).digest('hex');
}
async function dispatchImport(id, { env = process.env, request = fetch } = {}) {
	if (!env.NETLIFY) throw new Error('Dispatch Netlify non disponibile');
	// Deployment URL comes from Netlify, never from request headers or user input.
	const origin = env.DEPLOY_PRIME_URL || env.URL;
	if (!origin) throw new Error('URL del deployment non configurato');
	const body = JSON.stringify({ id, at: Date.now() });
	const response = await request(new URL('/.netlify/functions/product-import-background', origin), {
		method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Signature': signature(body, env) },
		body, signal: AbortSignal.timeout(4000),
	});
	if (response.status !== 202) throw new Error(`Avvio aggiunta: HTTP ${response.status}`);
}
function verifyInvocation(body, signed, env = process.env) {
	try {
		if (typeof signed !== 'string' || !/^[a-f0-9]{64}$/.test(signed)) return null;
		if (!timingSafeEqual(Buffer.from(signature(body, env), 'hex'), Buffer.from(signed, 'hex'))) return null;
		const data = JSON.parse(body);
		if (typeof data.id !== 'string' || !Number.isFinite(data.at) || Math.abs(Date.now() - data.at) > 60000) return null;
		return data;
	} catch { return null; }
}
module.exports = { dispatchImport, verifyInvocation, signature };
