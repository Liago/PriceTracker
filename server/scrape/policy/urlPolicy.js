/**
 * Politica di accesso agli URL.
 *
 * Sostituisce la whitelist di domini (difetto D1), che rendeva impossibile per
 * costruzione l'obiettivo di leggere qualunque shop. Aprire il motore a
 * qualunque dominio non significa pero' togliere i controlli: significa
 * sostituire un controllo di appartenenza - inutile come difesa e fatale come
 * limite - con controlli veri.
 *
 * Il piu' importante e' la protezione da SSRF. Un URL fornito dall'utente che
 * il nostro server visita e' un vettore classico: "http://169.254.169.254/"
 * legge le credenziali dell'istanza cloud, "http://localhost:5432" sonda i
 * servizi interni. La difesa e' risolvere il DNS e rifiutare gli indirizzi non
 * pubblici - RI-VERIFICANDO dopo ogni redirect, perche' un dominio pubblico
 * puo' reindirizzare a un indirizzo interno.
 */

const dns = require('dns').promises;
const net = require('net');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const REJECT = Object.freeze({
	EMPTY: 'url_mancante',
	MALFORMED: 'url_malformato',
	TOO_LONG: 'url_troppo_lungo',
	PROTOCOL: 'protocollo_non_ammesso',
	CREDENTIALS: 'credenziali_nell_url',
	DNS: 'dns_non_risolvibile',
	PRIVATE_ADDRESS: 'indirizzo_non_pubblico',
	BLOCKED_DOMAIN: 'dominio_bloccato',
	ROBOTS: 'escluso_da_robots',
});

/**
 * Un indirizzo IP e' privato, riservato o comunque non pubblico?
 *
 * Copre gli intervalli che un attaccante userebbe per raggiungere la rete
 * interna o i servizi di metadati del cloud provider.
 */
function isPrivateAddress(address) {
	if (!address) return true;

	if (net.isIPv4(address)) {
		const parts = address.split('.').map(Number);
		const [a, b] = parts;

		if (a === 0) return true;                        // 0.0.0.0/8
		if (a === 10) return true;                       // privato
		if (a === 127) return true;                      // loopback
		if (a === 169 && b === 254) return true;         // link-local e metadati cloud
		if (a === 172 && b >= 16 && b <= 31) return true; // privato
		if (a === 192 && b === 168) return true;         // privato
		if (a === 192 && b === 0) return true;           // IETF protocol assignments
		if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
		if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
		if (a >= 224) return true;                       // multicast e riservati
		return false;
	}

	if (net.isIPv6(address)) {
		const lower = address.toLowerCase();
		if (lower === '::' || lower === '::1') return true;
		if (lower.startsWith('fe80')) return true;       // link-local
		if (/^f[cd]/.test(lower)) return true;           // unique local fc00::/7
		if (lower.startsWith('ff')) return true;         // multicast
		// IPv4 mappato: si valuta la parte IPv4.
		const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
		if (mapped) return isPrivateAddress(mapped[1]);
		return false;
	}

	return true; // non e' un indirizzo riconoscibile
}

/**
 * Controlli sintattici, senza rete.
 * @returns {{ok: boolean, reason?: string, url?: URL}}
 */
function checkSyntax(urlString) {
	if (!urlString || typeof urlString !== 'string' || urlString.trim() === '') {
		return { ok: false, reason: REJECT.EMPTY };
	}
	if (urlString.length > MAX_URL_LENGTH) {
		return { ok: false, reason: REJECT.TOO_LONG };
	}

	let url;
	try {
		url = new URL(urlString);
	} catch (e) {
		return { ok: false, reason: REJECT.MALFORMED };
	}

	if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
		return { ok: false, reason: REJECT.PROTOCOL };
	}
	// Credenziali nell'URL: usate per confondere l'origine reale
	// ("https://shop.it@192.168.1.1/").
	if (url.username || url.password) {
		return { ok: false, reason: REJECT.CREDENTIALS };
	}

	return { ok: true, url };
}

/**
 * Risolve l'host e verifica che tutti gli indirizzi siano pubblici.
 *
 * Si controllano TUTTI gli indirizzi restituiti, non solo il primo: un
 * attaccante puo' pubblicare un record con un indirizzo pubblico e uno
 * interno, contando su quale dei due verra' usato.
 *
 * @param {string} hostname
 * @param {object} [deps] - iniettabili per i test
 * @returns {Promise<{ok: boolean, reason?: string, addresses?: Array<string>}>}
 */
async function checkAddress(hostname, deps = {}) {
	const { lookup = (host) => dns.lookup(host, { all: true }) } = deps;

	// Un hostname che e' gia' un indirizzo IP non passa dal DNS.
	if (net.isIP(hostname)) {
		return isPrivateAddress(hostname)
			? { ok: false, reason: REJECT.PRIVATE_ADDRESS, addresses: [hostname] }
			: { ok: true, addresses: [hostname] };
	}

	let resolved;
	try {
		resolved = await lookup(hostname);
	} catch (e) {
		return { ok: false, reason: REJECT.DNS };
	}

	const addresses = (Array.isArray(resolved) ? resolved : [resolved])
		.map((entry) => (typeof entry === 'string' ? entry : entry.address))
		.filter(Boolean);

	if (addresses.length === 0) return { ok: false, reason: REJECT.DNS };

	if (addresses.some(isPrivateAddress)) {
		return { ok: false, reason: REJECT.PRIVATE_ADDRESS, addresses };
	}

	return { ok: true, addresses };
}

/**
 * Verifica completa di un URL prima di visitarlo.
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {object} [options.domainProfile] - riga di domain_profiles
 * @param {function} [options.lookup] - risolutore DNS iniettabile
 * @returns {Promise<{allowed: boolean, reason?: string, url?: string, hostname?: string, addresses?: Array<string>}>}
 */
async function checkUrl(urlString, options = {}) {
	const { domainProfile = null, lookup } = options;

	const syntax = checkSyntax(urlString);
	if (!syntax.ok) return { allowed: false, reason: syntax.reason };

	const { url } = syntax;

	// Blocklist: un dominio che ci blocca sistematicamente, o che ha chiesto di
	// non essere letto. E' l'eccezione al modello aperto per default.
	if (domainProfile?.block_reason) {
		const until = domainProfile.blocked_until ? new Date(domainProfile.blocked_until) : null;
		if (!until || until > new Date()) {
			return { allowed: false, reason: REJECT.BLOCKED_DOMAIN, detail: domainProfile.block_reason };
		}
	}

	if (domainProfile?.robots_allowed === false) {
		return { allowed: false, reason: REJECT.ROBOTS };
	}

	const address = await checkAddress(url.hostname, { lookup });
	if (!address.ok) {
		return { allowed: false, reason: address.reason, hostname: url.hostname, addresses: address.addresses };
	}

	return {
		allowed: true,
		url: url.toString(),
		hostname: url.hostname,
		addresses: address.addresses,
	};
}

/**
 * Verifica una catena di redirect.
 *
 * E' il controllo che rende utile tutto il resto: senza, un dominio pubblico
 * puo' reindirizzare a 169.254.169.254 e la verifica iniziale non serve a
 * nulla.
 *
 * @param {Array<string>} chain - URL nell'ordine in cui sono stati seguiti
 * @param {object} [options]
 * @returns {Promise<{allowed: boolean, reason?: string, at?: string}>}
 */
async function checkRedirectChain(chain, options = {}) {
	if (!Array.isArray(chain) || chain.length === 0) {
		return { allowed: false, reason: REJECT.EMPTY };
	}
	if (chain.length - 1 > MAX_REDIRECTS) {
		return { allowed: false, reason: 'troppi_redirect', at: chain[chain.length - 1] };
	}

	for (const step of chain) {
		const result = await checkUrl(step, options);
		if (!result.allowed) {
			return { allowed: false, reason: result.reason, at: step };
		}
	}

	return { allowed: true };
}

module.exports = {
	checkUrl,
	checkSyntax,
	checkAddress,
	checkRedirectChain,
	isPrivateAddress,
	REJECT,
	MAX_REDIRECTS,
	MAX_RESPONSE_BYTES,
	MAX_URL_LENGTH,
};
