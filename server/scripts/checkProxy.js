#!/usr/bin/env node
/**
 * Il proxy configurato basta a farci servire una pagina?
 *
 * Nasce da una domanda concreta - «il mio piano Webshare puo' servire?» - a
 * cui non si risponde ragionando sulle etichette del pannello. Un intervallo
 * di indirizzi o e' accettato da quel sito o non lo e', e la differenza fra
 * "datacenter" e "residenziale" e' un'indicazione di probabilita', non una
 * legge. Costa due minuti verificarlo e la verifica vale piu' di qualunque
 * stima, soprattutto quando la decisione che ne dipende e' una spesa.
 *
 * Lo script manda gli STESSI header del tier 0 (scrape/fetchHtml.js), perche'
 * una prova con header diversi misurerebbe un'altra cosa. Confronta la
 * risposta diretta con quella attraverso ogni proxy configurato e dice, per
 * ciascuno, se e' passato.
 *
 * Uso:
 *   PROXY_LIST="host:porta:utente:segreto,..." \
 *     node scripts/checkProxy.js https://www.esempio.it/prodotto
 *
 * Nessun URL: si usano i tre domini che in produzione ci hanno rifiutati.
 */

const axios = require('axios');
const { browserHeaders } = require('../scrape/fetchHtml');
const { detectInHtml } = require('../scrape/antiBot');
const { createProxyManagerFromEnv } = require('../utils/proxyManager');

const DEFAULT_TARGETS = [
	'https://www.backmarket.it/it-it/p/ipad-mini-6-2021-83-256gb-wifi-5g-galassia/ee9fa41d-4236-48cd-8303-0423e0f8bd1c',
	'https://www.pccomponentes.it/black-decker-1470w-19-bar-macchina-per-caffe-automatica-thermoblock-easytouch-grinder',
	'https://www.juice.it/mac-studio-apple-m2-max-32gb-512gb-ssd-usato-grado-a-dmqh73ta.html',
];

const TIMEOUT_MS = 20000;

/** Da { server, username, password } alla forma che axios vuole. */
function toAxiosProxy(proxy) {
	const url = new URL(proxy.server);
	return {
		protocol: url.protocol.replace(':', ''),
		host: url.hostname,
		port: Number(url.port) || 80,
		...(proxy.username ? { auth: { username: proxy.username, password: proxy.password } } : {}),
	};
}

/**
 * Una richiesta, e cosa ne e' venuto fuori.
 * @returns {Promise<{ok: boolean, status: number|null, bytes: number, verdict: string}>}
 */
async function attempt(url, proxy) {
	try {
		const response = await axios.get(url, {
			headers: browserHeaders(url),
			timeout: TIMEOUT_MS,
			maxRedirects: 5,
			responseType: 'text',
			decompress: true,
			// Nessuno status fa lanciare: un 403 e' un risultato, non un errore.
			validateStatus: () => true,
			...(proxy ? { proxy: toAxiosProxy(proxy) } : { proxy: false }),
		});

		const body = typeof response.data === 'string' ? response.data : '';
		const bytes = Buffer.byteLength(body, 'utf8');

		if (response.status === 403 || response.status === 429) {
			return { ok: false, status: response.status, bytes, verdict: 'RIFIUTATO' };
		}
		if (response.status >= 400) {
			return { ok: false, status: response.status, bytes, verdict: `HTTP ${response.status}` };
		}

		const challenge = detectInHtml(body);
		if (challenge.detected) {
			return { ok: false, status: response.status, bytes, verdict: `SFIDA (${challenge.type})` };
		}
		if (challenge.reason === 'pagina_troppo_piccola') {
			return { ok: false, status: response.status, bytes, verdict: 'PAGINA VUOTA' };
		}

		return { ok: true, status: response.status, bytes, verdict: 'PASSATO' };
	} catch (error) {
		return { ok: false, status: null, bytes: 0, verdict: `errore: ${error.code || error.message}` };
	}
}

/** Host del proxy, senza le credenziali: finiscono nei log. */
function label(proxy) {
	return proxy ? new URL(proxy.server).host : 'diretto (nessun proxy)';
}

async function main() {
	const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS;
	const manager = createProxyManagerFromEnv();
	const proxies = manager.hasProxies() ? manager.proxies : [];

	if (proxies.length === 0) {
		console.log('PROXY_LIST non e\' configurata: si prova solo la richiesta diretta.\n');
	} else {
		console.log(`${proxies.length} proxy configurati. Se ne provano al massimo tre.\n`);
	}

	// Tre bastano: se un intervallo e' accettato lo sono quasi sempre i suoi
	// vicini, e se e' rifiutato provarne cento non cambia la risposta.
	const toTry = [null, ...proxies.slice(0, 3)];

	for (const url of targets) {
		console.log(new URL(url).hostname);

		for (const proxy of toTry) {
			const result = await attempt(url, proxy);
			const mark = result.ok ? '  OK  ' : '  --  ';
			const size = result.bytes > 0 ? `${Math.round(result.bytes / 1024)} KB` : '-';
			console.log(`${mark} ${label(proxy).padEnd(28)} ${String(result.status ?? '-').padEnd(5)} ${size.padEnd(9)} ${result.verdict}`);
		}
		console.log('');
	}

	console.log('Un PASSATO attraverso un proxy significa che quel piano serve.');
	console.log('Tutti RIFIUTATO o SFIDA: quegli indirizzi sono classificati come i nostri,');
	console.log('e serve una rete diversa (residenziale), non piu\' proxy della stessa.');
}

main().catch((error) => {
	console.error('Verifica fallita:', error.message);
	process.exit(1);
});
