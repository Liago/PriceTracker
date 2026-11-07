import { describe, it, expect, vi } from 'vitest';
import scraper from '../services/scraper.js';
import routes from '../api/routes.js';

const url = 'https://www.backmarket.it/it-it/p/ipad-pro-2024-m4-series';
// Cio' che il log di produzione mostra: GET 403, poi 185 byte al browser.
const blockedPage = () => ({
	setViewport: async () => {}, setUserAgent: async () => {}, setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {},
	on: () => {}, url: () => url, title: async () => '', waitForFunction: async () => {}, evaluate: async () => null,
	goto: async () => ({ status: () => 403, headers: () => ({ server: 'cloudflare', 'cf-ray': '8f-MXP' }) }),
	content: async () => '<html><head></head><body>' + 'x'.repeat(140) + '</body></html>',
});

describe('negozio che blocca l\'indirizzo del server', () => {
	it('lo riconosce come rifiuto, non come pagina vuota, e non spreca tentativi senza proxy', async () => {
		const createBrowserImpl = vi.fn(async () => ({ newPage: async () => blockedPage(), close: async () => {} }));
		const error = await scraper.scrapeProduct(url, { budgetMs: 60000, maxRetries: 2, createBrowserImpl,
			fetchHtmlImpl: async () => ({ ok: false, reason: 'bloccato_dal_sito', status: 403, antiBotSuspected: true, durationMs: 160 }) }).catch(e => e);
		expect(error.reason).toBe('bloccato_dal_sito_403');
		expect(error.antiBotSuspected).toBe(true);
		expect(error.evidence).toMatchObject({ httpStatus: 403, blockVendor: 'cloudflare' });
		expect(createBrowserImpl).toHaveBeenCalledOnce();
	});
	it('all\'utente dice che il negozio blocca il server, non che la pagina e\' vuota', async () => {
		const handlers = {};
		const failure = Object.assign(new Error('SCRAPE_BUDGET_EXCEEDED: BLOCKED_BY_SITE:403'), { code: 'SCRAPE_BUDGET_EXCEEDED', reason: 'bloccato_dal_sito_403',
			antiBotSuspected: true, tier: 1, evidence: { httpStatus: 403, blockVendor: 'cloudflare', htmlBytes: 185 } });
		const chain = { select: () => chain, eq: () => chain, then: resolve => resolve({ data: [], error: null }) };
		const client = { auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) }, from: () => chain, rpc: vi.fn() };
		routes.registerRoutes({ getClient: () => client, scrapeImpl: async () => { throw failure; }, checkUrlImpl: async u => ({ allowed: true, url: u }) })({ use() {}, post: (p, h) => { handlers[p] = h; }, get() {} });
		const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await handlers['/products']({ headers: { authorization: 'Bearer t' }, body: { url } }, res);
		expect(res.code).toBe(503);
		expect(res.body.error).toContain('blocca le letture automatiche');
		expect(res.body.diagnostics).toMatchObject({ reason: 'bloccato_dal_sito_403', blockVendor: 'cloudflare', httpStatus: 403 });
	});
});

describe('verifica Cloudflare che si risolve nel browser', () => {
	const swappie = 'https://swappie.com/it/iphone-15-128gb-nero/';
	const product = '<html><head><title>iPhone 15</title></head><body><script>window.__INITIAL__DATA__ = {"productPageData":{"selectedProduct":{"id":"SKU1","name":"iPhone 15","storage":"128","color":"Nero","grade":"A","normalPrice":{"amount":49900,"precision":2,"currency":"EUR"},"stock":3}}}</script>' + 'x'.repeat(6000) + '</body></html>';
	const challenge = '<html><head><title>Un momento…</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' + 'y'.repeat(40000) + '</body></html>';
	const page = ({ solves }) => {
		let html = challenge;
		return {
			setViewport: async () => {}, setUserAgent: async () => {}, setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {},
			on: () => {}, url: () => swappie, title: async () => '', waitForFunction: async () => {}, evaluate: async () => null,
			goto: async () => ({ status: () => 403, headers: () => ({ server: 'cloudflare', 'cf-mitigated': 'challenge' }) }),
			waitForNavigation: vi.fn(async () => {
				if (!solves) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
				html = product;
				return { status: () => 200, headers: () => ({}) };
			}),
			content: async () => html,
		};
	};
	it('attende che la verifica carichi la scheda e la legge', async () => {
		const p = page({ solves: true });
		const out = await scraper.scrapeProduct(swappie, { allowHttp: false, budgetMs: 60000, maxRetries: 0,
			createBrowserImpl: async () => ({ newPage: async () => p, close: async () => {} }) });
		expect(p.waitForNavigation).toHaveBeenCalledOnce();
		expect(out.price).toBe(499);
		expect(out.sku).toBe('SKU1');
	});
	it('se la verifica non passa lo dice come tale, senza ripetere tentativi', async () => {
		const createBrowserImpl = vi.fn(async () => ({ newPage: async () => page({ solves: false }), close: async () => {} }));
		const error = await scraper.scrapeProduct(swappie, { allowHttp: false, budgetMs: 60000, maxRetries: 2, createBrowserImpl }).catch(e => e);
		expect(error.reason).toBe('bloccato_dal_sito_403');
		expect(error.evidence).toMatchObject({ challengeType: 'cloudflare_challenge', blockVendor: 'cloudflare' });
		expect(createBrowserImpl).toHaveBeenCalledOnce();
	});
	it('un rifiuto secco (pagina minima, nessuna verifica) non viene atteso', async () => {
		const p = { ...blockedPage(), waitForNavigation: vi.fn() };
		await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 60000, maxRetries: 0,
			createBrowserImpl: async () => ({ newPage: async () => p, close: async () => {} }) }).catch(() => {});
		expect(p.waitForNavigation).not.toHaveBeenCalled();
	});
});
