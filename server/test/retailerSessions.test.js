import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import sessions from '../scrape/retailerSessions.js';
import fetchModule from '../scrape/fetchHtml.js';
import scraper from '../services/scraper.js';

const url = 'https://www.amazon.it/dp/B07QC8CXR6';
const cookies = [
	{ name: 'session-id', value: '123', domain: '.amazon.it', path: '/', expires: Date.now() / 1000 + 3600, httpOnly: false, secure: true },
	{ name: 'ubid-acbit', value: 'abc', domain: '.amazon.it', path: '/', expires: -1, httpOnly: false, secure: true },
	{ name: 'tracker', value: 'x', domain: '.ads.example', path: '/' },
];
const pricedPage = '<h1 id="productTitle">Fondonatura</h1><div id="availability">Disponibilità immediata</div><div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">12,90 €</span></span></div>';

beforeEach(() => sessions.resetSessions());

describe('archivio delle sessioni', () => {
	it('conserva solo i cookie del retailer e li rende fino alla scadenza', async () => {
		let time = 1_000_000;
		const store = sessions.createSessionStore(null, { now: () => time, ttlMs: 1000 });
		const saved = await store.save('amazon.it', { cookies, userAgent: 'UA', location: '20121' });
		expect(saved.cookies.map(c => c.name)).toEqual(['session-id', 'ubid-acbit']);
		expect((await store.get('amazon.it')).userAgent).toBe('UA');
		time += 1001;
		expect(await store.get('amazon.it')).toBeNull();
	});
	it('senza la tabella lavora in memoria e non fa fallire la lettura', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { message: 'relation "retailer_sessions" does not exist' } }),
			upsert: async () => ({ error: { message: 'relation "retailer_sessions" does not exist' } }) };
		const store = sessions.createSessionStore({ from: () => chain });
		expect(await store.get('amazon.it')).toBeNull();
		await store.save('amazon.it', { cookies });
		expect((await store.get('amazon.it')).cookies).toHaveLength(2);
		warn.mockRestore();
	});
	it('salva e rilegge dalla tabella fra invocazioni diverse', async () => {
		const rows = {};
		const chain = { key: null, select() { return this; }, eq(_, key) { this.key = key; return this; },
			maybeSingle: async function () { return { data: rows[this.key] || null, error: null }; },
			upsert: async row => { rows[row.key] = row; return { error: null }; } };
		await sessions.createSessionStore({ from: () => chain }).save('amazon.it', { cookies, userAgent: 'UA', location: '20121' });
		sessions.resetSessions();
		const loaded = await sessions.createSessionStore({ from: () => chain }).get('amazon.it');
		expect(loaded).toMatchObject({ userAgent: 'UA', location: '20121' });
		expect(loaded.cookies).toHaveLength(2);
	});
	it('la chiave esiste solo per i siti che ne hanno bisogno', () => {
		expect(sessions.sessionKey(url)).toBe('amazon.it');
		expect(sessions.sessionKey('https://shop.example/a')).toBeNull();
	});
});

describe('cookie nelle richieste HTTP', () => {
	it('arrivano solo agli host del dominio della sessione, anche dopo un redirect', async () => {
		const session = { cookies: sessions.sanitizeCookies(cookies, 'amazon.it'), userAgent: 'Mozilla/5.0 Test' };
		const sent = [];
		const fetchImpl = async (target, options) => {
			sent.push({ target, cookie: options.headers.Cookie, ua: options.headers['User-Agent'] });
			return target.includes('amazon.it')
				? { status: 302, headers: { get: () => 'https://other.example/landing' } }
				: { status: 200, headers: { get: () => 'text/html' }, body: null, arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer };
		};
		await fetchModule.fetchHtml(url, { fetchImpl, checkUrlImpl: async u => ({ allowed: true, url: u }), session, timeoutMs: 2000 });
		expect(sent[0]).toMatchObject({ cookie: 'session-id=123; ubid-acbit=abc', ua: 'Mozilla/5.0 Test' });
		expect(sent[1].cookie).toBeUndefined();
	});
});

describe('letture con la sessione salvata', () => {
	it('con la posizione gia\' italiana basta la lettura HTTP: niente browser, niente cambio di CAP', async () => {
		const store = sessions.createSessionStore(null);
		await store.save('amazon.it', { cookies, userAgent: 'UA', location: '20121' });
		const fetchHtmlImpl = vi.fn(async (target, options) => ({ ok: true, html: pricedPage, url: target, durationMs: 1, seen: options.session }));
		const createBrowserImpl = vi.fn();
		const out = await scraper.scrapeProduct(url, { budgetMs: 20000, sessions: store, fetchHtmlImpl, createBrowserImpl });
		expect(out.price).toBe(12.9);
		expect(fetchHtmlImpl.mock.calls[0][1].session.location).toBe('20121');
		expect(createBrowserImpl).not.toHaveBeenCalled();
	});
	it('dopo un cambio di CAP riuscito il browser salva la sessione con il suo User-Agent', async () => {
		const store = sessions.createSessionStore(null);
		const dom = new JSDOM('<span id="glow-ingress-line2">Stati Uniti</span><div id="availability">Non disponibile</div>', { url, runScripts: 'outside-only' });
		const doc = dom.window.document;
		doc.body.insertAdjacentHTML('beforeend', `<span id="nav-global-location-data-modal-action" data-a-modal='{"url":"/m","ajaxHeaders":{}}'></span>`);
		dom.window.fetch = async target => (String(target) === '/m'
			? { ok: true, status: 200, text: async () => 'CSRF_TOKEN : "T"' }
			: { ok: true, status: 200, json: async () => ({ isValidAddress: 1, isAddressUpdated: 1 }) });
		const page = {
			setViewport: async () => {}, setUserAgent: vi.fn(async () => {}), setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {},
			on: () => {}, goto: async () => {}, url: () => url, title: async () => 'Fondonatura', waitForFunction: async () => {},
			evaluate: async (fn, arg) => dom.window.eval(`(${fn.toString()})`)(arg),
			reload: async () => { doc.body.innerHTML = `<span id="glow-ingress-line2">20121</span>${pricedPage}`; },
			content: async () => dom.serialize(), cookies: async () => cookies,
		};
		const out = await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 30000, maxRetries: 0, sessions: store,
			createBrowserImpl: async () => ({ newPage: async () => page, close: async () => {} }) });
		expect(out.price).toBe(12.9);
		const saved = await store.get('amazon.it');
		expect(saved).toMatchObject({ location: '20121', userAgent: page.setUserAgent.mock.calls[0][0] });
		expect(saved.cookies).toHaveLength(2);
	});
	it('riusa nel browser i cookie e lo User-Agent della sessione', async () => {
		const store = sessions.createSessionStore(null);
		await store.save('amazon.it', { cookies, userAgent: 'UA-SESSIONE', location: '20121' });
		const dom = new JSDOM(`<span id="glow-ingress-line2">20121</span>${pricedPage}`, { url });
		const page = {
			setViewport: async () => {}, setUserAgent: vi.fn(async () => {}), setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {},
			on: () => {}, goto: async () => {}, url: () => url, title: async () => 'x', waitForFunction: async () => {},
			setCookie: vi.fn(async () => {}), evaluate: async (fn, arg) => dom.window.eval(`(${fn.toString()})`)(arg), content: async () => dom.serialize(),
		};
		const out = await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 30000, maxRetries: 0, sessions: store,
			createBrowserImpl: async () => ({ newPage: async () => page, close: async () => {} }) });
		expect(out.price).toBe(12.9);
		expect(page.setUserAgent).toHaveBeenCalledWith('UA-SESSIONE');
		expect(page.setCookie.mock.calls[0]).toHaveLength(2);
	});
});
