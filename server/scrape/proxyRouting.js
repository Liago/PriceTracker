/**
 * Quando passare da un proxy.
 *
 * Il proxy costa (banda a consumo) e rallenta: non serve ai siti che ci
 * leggono senza problemi, Amazon compreso. Serve ai siti che rifiutano
 * l'indirizzo delle function - Back Market, Swappie - e li si individua in due
 * modi:
 *
 *  - configurazione: PROXY_DOMAINS="backmarket.it,swappie.com" li manda sempre
 *    dal proxy, senza sprecare un primo tentativo diretto;
 *  - osservazione: un 403/429 a una lettura diretta segna il dominio, e da li'
 *    in poi (nello stesso container) si passa dal proxy.
 *
 * Senza PROXY_LIST nulla cambia: ogni lettura resta diretta.
 */
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const LEARN_TTL_MS = 6 * 3600 * 1000;
const learned = new Map();
const agents = new Map();

function domainOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
}

function configuredDomains(env = process.env) {
	return (env.PROXY_DOMAINS || '').split(',').map(d => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
}

/** Il dominio va letto dal proxy? Vale anche per i sottodomini di un dominio configurato. */
function needsProxy(url, { env = process.env, now = Date.now() } = {}) {
	const domain = domainOf(url);
	if (!domain) return false;
	if (configuredDomains(env).some(d => domain === d || domain.endsWith(`.${d}`))) return true;
	const until = learned.get(domain);
	return Boolean(until && until > now);
}

/** Un rifiuto osservato su una lettura diretta: le prossime passano dal proxy. */
function markNeedsProxy(url, { now = Date.now() } = {}) {
	const domain = domainOf(url);
	if (!domain || needsProxy(url)) return;
	learned.set(domain, now + LEARN_TTL_MS);
	console.log(`[Proxy] ${domain} rifiuta le letture dirette: le prossime passano dal proxy`);
}

/** fetch che esce dal proxy indicato. Un agente per proxy, riusato. */
function proxiedFetch(proxy) {
	const key = `${proxy.server}|${proxy.username || ''}`;
	if (!agents.has(key)) {
		const token = proxy.username ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}` : undefined;
		agents.set(key, new ProxyAgent({ uri: proxy.server, ...(token ? { token } : {}) }));
	}
	const dispatcher = agents.get(key);
	return (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
}

/** Una forma del proxy da mettere nei log: mai le credenziali. */
function describeProxy(proxy) {
	if (!proxy) return null;
	try { return new URL(proxy.server).host; } catch { return 'proxy'; }
}

function resetProxyRouting() {
	learned.clear();
}

module.exports = { needsProxy, markNeedsProxy, proxiedFetch, describeProxy, configuredDomains, resetProxyRouting };
