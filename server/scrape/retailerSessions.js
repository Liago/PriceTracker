/**
 * Sessioni dei retailer con la posizione di consegna gia' impostata.
 *
 * Amazon decide dove si trova chi guarda dall'indirizzo IP: dalle function
 * risulta «Stati Uniti» e la scheda non ha prezzo. Il CAP si imposta nel
 * browser (circa 20 secondi); la sessione che Amazon apre in quel momento si
 * conserva qui e si riusa, anche nella lettura HTTP, finche' non scade.
 *
 * I cookie sono quelli che il retailer ha emesso, mai inventati. Restano in
 * memoria nel container e, se la migrazione 014 e' applicata, in
 * `retailer_sessions` (solo service role). Senza tabella si lavora in memoria:
 * nessun errore, solo meno riuso fra un'invocazione e l'altra.
 */
const { retailerOf } = require('./extract/retailers');

const TTL_MS = parseInt(process.env.RETAILER_SESSION_TTL_MS || String(12 * 3600 * 1000), 10);
const MAX_COOKIES = 60;
const memory = new Map();
let databaseUnavailable = false;

/** Chiave di sessione: il dominio del retailer, senza www. Null se il sito non ne ha bisogno. */
function sessionKey(url) {
	try {
		if (retailerOf(url) !== 'amazon') return null;
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
}

/** Solo i cookie del retailer, nella forma minima che serve a riusarli. */
function sanitizeCookies(cookies, key) {
	return (cookies || [])
		.filter(c => c && typeof c.name === 'string' && typeof c.value === 'string' && String(c.domain || '').replace(/^\./, '').endsWith(key))
		.slice(0, MAX_COOKIES)
		.map(({ name, value, domain, path = '/', expires, httpOnly, secure, sameSite }) => ({ name, value, domain, path,
			...(Number.isFinite(expires) && expires > 0 ? { expires } : {}), httpOnly: Boolean(httpOnly), secure: Boolean(secure), ...(sameSite ? { sameSite } : {}) }));
}

/** Header Cookie per una richiesta HTTP: solo cookie del dominio e non scaduti. */
function cookieHeader(session, url, now = Date.now()) {
	if (!session?.cookies?.length) return null;
	let host;
	try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
	const pairs = session.cookies
		.filter(c => { const domain = String(c.domain || '').replace(/^\./, '').toLowerCase(); return host === domain || host.endsWith(`.${domain}`); })
		.filter(c => !c.expires || c.expires * 1000 > now)
		.map(c => `${c.name}=${c.value}`);
	return pairs.length ? pairs.join('; ') : null;
}

function isFresh(session, now) {
	return Boolean(session && Date.parse(session.expiresAt) > now);
}

/**
 * @param {object|null} client - client Supabase service_role, opzionale
 */
function createSessionStore(client = null, { now = () => Date.now(), ttlMs = TTL_MS } = {}) {
	const useDatabase = () => Boolean(client) && !databaseUnavailable;
	const disable = error => {
		if (!databaseUnavailable) console.warn(`[Sessioni] Tabella retailer_sessions non disponibile (${error.message}): solo memoria`);
		databaseUnavailable = true;
	};

	return {
		async get(key) {
			if (!key) return null;
			const cached = memory.get(key);
			if (isFresh(cached, now())) return cached;
			if (!useDatabase()) return null;
			try {
				const { data, error } = await client.from('retailer_sessions').select('cookies, user_agent, location, expires_at').eq('key', key).maybeSingle();
				if (error) { disable(error); return null; }
				if (!data) return null;
				const session = { key, cookies: data.cookies || [], userAgent: data.user_agent, location: data.location, expiresAt: data.expires_at };
				if (!isFresh(session, now())) return null;
				memory.set(key, session);
				return session;
			} catch (error) {
				disable(error);
				return null;
			}
		},
		async save(key, { cookies, userAgent = null, location = null }) {
			const clean = sanitizeCookies(cookies, key);
			if (!key || !clean.length) return null;
			const session = { key, cookies: clean, userAgent, location, expiresAt: new Date(now() + ttlMs).toISOString() };
			memory.set(key, session);
			if (useDatabase()) {
				try {
					const { error } = await client.from('retailer_sessions').upsert({ key, cookies: clean, user_agent: userAgent, location,
						created_at: new Date(now()).toISOString(), expires_at: session.expiresAt }, { onConflict: 'key' });
					if (error) disable(error);
				} catch (error) {
					disable(error);
				}
			}
			return session;
		},
		async invalidate(key) {
			memory.delete(key);
			if (!useDatabase()) return;
			try { await client.from('retailer_sessions').delete().eq('key', key); } catch { /* La sessione scade comunque. */ }
		},
	};
}

/** Solo per i test: dimentica la memoria e lo stato della tabella. */
function resetSessions() {
	memory.clear();
	databaseUnavailable = false;
}

module.exports = { createSessionStore, sessionKey, cookieHeader, sanitizeCookies, resetSessions, TTL_MS };
