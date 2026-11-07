import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';

// Il manager del proxy legge PROXY_LIST al caricamento dello scraper.
process.env.PROXY_LIST = 'http://utente:p%40ss%3Aword@127.0.0.1:9/';
const { ProxyManager } = await import('../utils/proxyManager.js').then(m => m.default || m);
const routing = await import('../scrape/proxyRouting.js').then(m => m.default || m);
const fetchModule = await import('../scrape/fetchHtml.js').then(m => m.default || m);
const scraper = await import('../services/scraper.js').then(m => m.default || m);

const allow = async u => ({ allowed: true, url: u });
beforeEach(() => routing.resetProxyRouting());
afterAll(() => { delete process.env.PROXY_LIST; delete process.env.PROXY_DOMAINS; });

describe('configurazione del proxy', () => {
	it('accetta il formato URL di Webshare e decodifica le credenziali', () => {
		const [proxy] = new ProxyManager('http://utente:p%40ss%3Aword@82.0.0.1:8080/').proxies;
		expect(proxy).toEqual({ server: 'http://82.0.0.1:8080', username: 'utente', password: 'p@ss:word' });
	});
	it('nei log compare solo host e porta, mai le credenziali', () => {
		expect(routing.describeProxy({ server: 'http://82.0.0.1:8080', username: 'u', password: 'segreto' })).toBe('82.0.0.1:8080');
	});
	it('PROXY_DOMAINS manda dal proxy anche i sottodomini; gli altri siti restano diretti', () => {
		const env = { PROXY_DOMAINS: 'backmarket.it, swappie.com' };
		expect(routing.needsProxy('https://www.backmarket.it/it-it/p/x', { env })).toBe(true);
		expect(routing.needsProxy('https://swappie.com/it/x', { env })).toBe(true);
		expect(routing.needsProxy('https://www.amazon.it/dp/B0', { env })).toBe(false);
	});
	it('un rifiuto osservato fa passare dal proxy le letture successive del dominio', () => {
		expect(routing.needsProxy('https://www.backmarket.it/a', { env: {} })).toBe(false);
		routing.markNeedsProxy('https://www.backmarket.it/a');
		expect(routing.needsProxy('https://www.backmarket.it/b', { env: {} })).toBe(true);
	});
});

describe('lettura HTTP attraverso un proxy reale', () => {
	let target, proxy, seenAuth = [];
	beforeAll(async () => {
		target = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><title>ok via proxy</title></html>'); });
		await new Promise(r => target.listen(0, '127.0.0.1', r));
		proxy = http.createServer();
		proxy.on('connect', (req, socket) => {
			seenAuth.push(req.headers['proxy-authorization']);
			if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('utente:p@ss:word').toString('base64')}`) {
				socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
			}
			const [host, port] = req.url.split(':');
			const upstream = net.connect(Number(port), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(socket); socket.pipe(upstream); });
			upstream.on('error', () => socket.destroy());
		});
		await new Promise(r => proxy.listen(0, '127.0.0.1', r));
	});
	afterAll(() => { target.close(); proxy.close(); });

	it('si autentica con le credenziali decodificate e riceve la pagina', async () => {
		const [configured] = new ProxyManager(`http://utente:p%40ss%3Aword@127.0.0.1:${proxy.address().port}/`).proxies;
		const out = await fetchModule.fetchHtml(`http://127.0.0.1:${target.address().port}/prodotto`, { proxy: configured, checkUrlImpl: allow, timeoutMs: 5000 });
		expect(out.ok).toBe(true);
		expect(out.html).toContain('ok via proxy');
		expect(seenAuth.at(-1)).toBe(`Basic ${Buffer.from('utente:p@ss:word').toString('base64')}`);
	});
});

describe('quando lo scraper usa il proxy', () => {
	const url = 'https://www.backmarket.it/it-it/p/ipad/abc';
	const page = '<html><head><title>iPad</title><script type="application/ld+json">{"@type":"Product","name":"iPad","sku":"X1","offers":{"@type":"Offer","price":"499.00","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script></head><body>' + 'x'.repeat(3000) + '</body></html>';

	it('un 403 diretto viene riprovato subito dal proxy, senza avviare il browser', async () => {
		const fetchHtmlImpl = vi.fn(async (target, options) => (options.proxy
			? { ok: true, html: page, url: target, durationMs: 5 }
			: { ok: false, reason: 'bloccato_dal_sito', status: 403, antiBotSuspected: true, durationMs: 80 }));
		const createBrowserImpl = vi.fn();
		const out = await scraper.scrapeProduct(url, { budgetMs: 30000, fetchHtmlImpl, createBrowserImpl });
		expect(out.price).toBe(499);
		expect(fetchHtmlImpl).toHaveBeenCalledTimes(2);
		expect(fetchHtmlImpl.mock.calls[1][1].proxy.server).toBe('http://127.0.0.1:9');
		expect(createBrowserImpl).not.toHaveBeenCalled();
	});
	it('un sito che legge bene non passa dal proxy', async () => {
		const fetchHtmlImpl = vi.fn(async target => ({ ok: true, html: page, url: target, durationMs: 5 }));
		await scraper.scrapeProduct('https://shop.example/ipad', { budgetMs: 30000, fetchHtmlImpl });
		expect(fetchHtmlImpl.mock.calls[0][1].proxy).toBeUndefined();
	});
	it('un rifiuto al browser diretto passa al browser con proxy anche senza ripetizioni configurate', async () => {
		const launched = [];
		const pageFor = proxied => ({
			setViewport: async () => {}, setUserAgent: async () => {}, setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {},
			on: () => {}, url: () => 'https://negozio-protetto.example/ipad', title: async () => 'iPad', waitForFunction: async () => {}, evaluate: async () => null, authenticate: vi.fn(async () => {}),
			goto: async () => (proxied ? { status: () => 200, headers: () => ({}) } : { status: () => 403, headers: () => ({ server: 'cloudflare' }) }),
			content: async () => (proxied ? page : '<html></html>'),
		});
		const createBrowserImpl = vi.fn(async proxy => { launched.push(proxy); return { newPage: async () => pageFor(Boolean(proxy)), close: async () => {} }; });
		const out = await scraper.scrapeProduct('https://negozio-protetto.example/ipad', { allowHttp: false, budgetMs: 60000, maxRetries: 0, createBrowserImpl });
		expect(out.price).toBe(499);
		expect(launched.map(Boolean)).toEqual([false, true]);
	});
});
