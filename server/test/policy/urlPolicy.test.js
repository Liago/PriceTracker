import { describe, it, expect } from 'vitest';
import policyModule from '../../scrape/policy/urlPolicy.js';

const { checkUrl, checkSyntax, checkAddress, checkRedirectChain, isPrivateAddress, REJECT } = policyModule;

/** DNS finto: mappa hostname -> indirizzi. */
const fakeLookup = (map) => async (hostname) => {
	if (!map[hostname]) throw new Error('ENOTFOUND');
	return map[hostname].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

const publicDns = fakeLookup({ 'shop.example.it': ['93.184.216.34'] });

describe('isPrivateAddress - la difesa da SSRF', () => {
	it('riconosce gli indirizzi che un attaccante userebbe', () => {
		const pericolosi = [
			'127.0.0.1',        // loopback
			'10.0.0.5',         // rete privata
			'172.16.0.1',       // rete privata
			'172.31.255.255',   // rete privata, estremo
			'192.168.1.1',      // rete domestica
			'169.254.169.254',  // metadati del cloud provider
			'0.0.0.0',
			'100.64.0.1',       // CGNAT
			'224.0.0.1',        // multicast
			'::1',              // loopback IPv6
			'fe80::1',          // link-local IPv6
			'fc00::1',          // unique local IPv6
			'::ffff:127.0.0.1', // IPv4 mappato in IPv6
		];
		for (const address of pericolosi) {
			expect(isPrivateAddress(address), address).toBe(true);
		}
	});

	it('lascia passare gli indirizzi pubblici', () => {
		for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) {
			expect(isPrivateAddress(address), address).toBe(false);
		}
	});

	it('rifiuta cio\' che non riconosce', () => {
		expect(isPrivateAddress('non-un-ip')).toBe(true);
		expect(isPrivateAddress(null)).toBe(true);
		expect(isPrivateAddress('')).toBe(true);
	});
});

describe('checkSyntax', () => {
	it('accetta http e https', () => {
		expect(checkSyntax('https://shop.it/p').ok).toBe(true);
		expect(checkSyntax('http://shop.it/p').ok).toBe(true);
	});

	it('rifiuta gli altri protocolli', () => {
		for (const url of ['file:///etc/passwd', 'ftp://shop.it/x', 'gopher://shop.it', 'javascript:alert(1)']) {
			expect(checkSyntax(url).reason, url).toBe(REJECT.PROTOCOL);
		}
	});

	it('rifiuta le credenziali nell\'URL', () => {
		// "https://shop.it@192.168.1.1/" sembra shop.it ma punta altrove.
		expect(checkSyntax('https://utente:pass@shop.it/p').reason).toBe(REJECT.CREDENTIALS);
		expect(checkSyntax('https://shop.it@192.168.1.1/').reason).toBe(REJECT.CREDENTIALS);
	});

	it('rifiuta vuoto, malformato e troppo lungo', () => {
		expect(checkSyntax('').reason).toBe(REJECT.EMPTY);
		expect(checkSyntax(null).reason).toBe(REJECT.EMPTY);
		expect(checkSyntax('non-un-url').reason).toBe(REJECT.MALFORMED);
		expect(checkSyntax('https://shop.it/' + 'a'.repeat(3000)).reason).toBe(REJECT.TOO_LONG);
	});
});

describe('checkAddress', () => {
	it('accetta un host che risolve a indirizzi pubblici', async () => {
		const out = await checkAddress('shop.example.it', { lookup: publicDns });
		expect(out.ok).toBe(true);
	});

	it('rifiuta un host che risolve a un indirizzo interno', async () => {
		const lookup = fakeLookup({ 'interno.example.it': ['192.168.1.10'] });
		expect((await checkAddress('interno.example.it', { lookup })).reason).toBe(REJECT.PRIVATE_ADDRESS);
	});

	it('rifiuta se ANCHE UNO SOLO degli indirizzi e\' interno', async () => {
		// Un record con un indirizzo pubblico e uno interno: l'attaccante conta
		// su quale dei due verra' usato.
		const lookup = fakeLookup({ 'misto.example.it': ['93.184.216.34', '127.0.0.1'] });
		expect((await checkAddress('misto.example.it', { lookup })).reason).toBe(REJECT.PRIVATE_ADDRESS);
	});

	it('valuta direttamente un hostname che e\' gia\' un IP', async () => {
		expect((await checkAddress('169.254.169.254', {})).reason).toBe(REJECT.PRIVATE_ADDRESS);
		expect((await checkAddress('93.184.216.34', {})).ok).toBe(true);
	});

	it('rifiuta un host non risolvibile', async () => {
		expect((await checkAddress('inesistente.example', { lookup: publicDns })).reason).toBe(REJECT.DNS);
	});
});

describe('checkUrl - il modello aperto per default', () => {
	it('accetta uno shop mai visto prima', async () => {
		// E' il punto dell'intero refactor: nessuna whitelist.
		const out = await checkUrl('https://shop.example.it/prodotto/123', { lookup: publicDns });
		expect(out.allowed).toBe(true);
		expect(out.hostname).toBe('shop.example.it');
	});

	it('blocca un dominio con block_reason attivo', async () => {
		const out = await checkUrl('https://shop.example.it/p', {
			lookup: publicDns,
			domainProfile: { block_reason: 'richiesta del gestore' },
		});
		expect(out.allowed).toBe(false);
		expect(out.reason).toBe(REJECT.BLOCKED_DOMAIN);
	});

	it('riammette un dominio il cui blocco temporaneo e\' scaduto', async () => {
		const out = await checkUrl('https://shop.example.it/p', {
			lookup: publicDns,
			domainProfile: { block_reason: 'troppi 429', blocked_until: new Date(Date.now() - 1000).toISOString() },
		});
		expect(out.allowed).toBe(true);
	});

	it('rispetta robots quando il profilo dice di no', async () => {
		const out = await checkUrl('https://shop.example.it/p', {
			lookup: publicDns, domainProfile: { robots_allowed: false },
		});
		expect(out.reason).toBe(REJECT.ROBOTS);
	});
});

describe('checkRedirectChain', () => {
	const lookup = fakeLookup({
		'shop.example.it': ['93.184.216.34'],
		'cdn.example.it': ['93.184.216.35'],
		'trappola.example.it': ['169.254.169.254'],
	});

	it('accetta una catena tutta pubblica', async () => {
		const out = await checkRedirectChain(
			['https://shop.example.it/p', 'https://cdn.example.it/p'], { lookup });
		expect(out.allowed).toBe(true);
	});

	it('blocca un redirect verso un indirizzo interno', async () => {
		// Senza questo controllo, la verifica iniziale non servirebbe a nulla:
		// basterebbe un dominio pubblico che reindirizza ai metadati cloud.
		const out = await checkRedirectChain(
			['https://shop.example.it/p', 'https://trappola.example.it/'], { lookup });

		expect(out.allowed).toBe(false);
		expect(out.reason).toBe(REJECT.PRIVATE_ADDRESS);
		expect(out.at).toContain('trappola');
	});

	it('rifiuta le catene troppo lunghe', async () => {
		const chain = Array(8).fill('https://shop.example.it/p');
		expect((await checkRedirectChain(chain, { lookup })).reason).toBe('troppi_redirect');
	});

	it('rifiuta una catena vuota', async () => {
		expect((await checkRedirectChain([], { lookup })).allowed).toBe(false);
	});
});
