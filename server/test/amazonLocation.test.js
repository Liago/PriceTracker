import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import scraper from '../services/scraper.js';
import engine from '../scrape/index.js';

const redirect = location => ({ status: 301, headers: { get: name => (name === 'location' ? location : null) } });

describe('link brevi Amazon', () => {
	it('segue il redirect fino alla scheda Amazon senza scaricarla', async () => {
		const request = vi.fn().mockResolvedValueOnce(redirect('https://www.amazon.it/dp/B0ABCDEF12?ref=share'));
		expect(await scraper.resolveAmazonShortLink('https://amzn.eu/d/0gN8V1FD', { request })).toBe('https://www.amazon.it/dp/B0ABCDEF12?ref=share');
		expect(request.mock.calls[0][1].redirect).toBe('manual');
	});
	it('non insegue redirect verso siti diversi da Amazon', async () => {
		const request = vi.fn().mockResolvedValueOnce(redirect('https://evil.example/x'));
		expect(await scraper.resolveAmazonShortLink('https://amzn.eu/d/x', { request })).toBe('https://amzn.eu/d/x');
	});
	it('non tocca gli URL normali', async () => {
		const request = vi.fn();
		expect(await scraper.resolveAmazonShortLink('https://shop.example/a', { request })).toBe('https://shop.example/a');
		expect(request).not.toHaveBeenCalled();
	});
	it('scarica la scheda risolta, con la variante confermata', async () => {
		let requested;
		await scraper.scrapeProduct('https://amzn.eu/d/0gN8V1FD', {
			budgetMs: 1500, allowBrowser: false,
			resolveShortLinkImpl: async () => 'https://www.amazon.it/Zeiss/dp/B09K48BMV8/ref=cm_sw?th=1',
			fetchHtmlImpl: async target => { requested = target; return { ok: true, html: '<h1 id="productTitle">Zeiss</h1>', url: target, durationMs: 1 }; },
		}).catch(() => {});
		expect(requested).toBe('https://www.amazon.it/dp/B09K48BMV8?psc=1');
	});
});

describe('posizione di consegna Amazon', () => {
	const url = 'https://www.amazon.it/dp/B09K48BMV8';
	const shell = '<span id="glow-ingress-line2">Stati Uniti</span><a id="nav-global-location-popover-link"></a><div id="buybox">Questo articolo non può essere spedito al tuo indirizzo</div>';
	function fakePage({ confirm = true } = {}) {
		const dom = new JSDOM(`<html><body>${shell}</body></html>`, { url, runScripts: 'outside-only' });
		const doc = dom.window.document;
		doc.querySelector('#nav-global-location-popover-link').addEventListener('click', () => {
			doc.body.insertAdjacentHTML('beforeend', '<input id="GLUXZipUpdateInput"><span id="GLUXZipUpdate"><input class="a-button-input" type="submit"></span>');
		});
		const typed = [];
		return {
			typed, dom,
			evaluate: async (fn, arg) => dom.window.eval(`(${fn.toString()})`)(arg),
			waitForSelector: async selector => { if (!doc.querySelector(selector)) throw Object.assign(new Error('x'), { name: 'TimeoutError' }); },
			type: async (selector, text) => { typed.push(text); doc.querySelector(selector).value = text; },
			waitForResponse: async () => (confirm ? { ok: () => true, status: () => 200, url: () => 'https://www.amazon.it/portal-migration/hz/glow/address-change' } : null),
			reload: async () => {
				doc.body.innerHTML = '<span id="glow-ingress-line2">Milano 20121</span><div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">19,99 €</span></span></div>';
			},
			content: async () => dom.serialize(),
		};
	}
	it('imposta il CAP italiano con il selettore «Invia a» e ricarica la scheda', async () => {
		const page = fakePage();
		const out = await scraper.setAmazonDeliveryLocation(page, url, 20000);
		expect(out).toMatchObject({ before: 'Stati Uniti', after: 'Milano 20121', zip: '20121', updated: true, error: null });
		expect(page.typed).toEqual(['20121']);
		expect(engine.interpret(await page.content(), { url }).price).toBe(19.99);
	});
	it('senza conferma di Amazon la pagina resta com\'era e lo dice', async () => {
		const out = await scraper.setAmazonDeliveryLocation(fakePage({ confirm: false }), url, 20000);
		expect(out.updated).toBe(false);
		expect(out.error).toBe('nessuna_conferma');
	});
	it('la diagnostica riporta la posizione e il buy box servito al posto del prezzo', () => {
		const out = engine.interpret(`<h1 id="productTitle">Zeiss</h1>${shell}`, { url });
		expect(out.price).toBeNull();
		expect(out.priceDiagnostics.page.deliveryLocation).toBe('Stati Uniti');
		expect(out.priceDiagnostics.page.buyBox).toContain('non può essere spedito');
	});
	it('imposta il CAP anche quando la scheda dice «non disponibile» e l\'attesa non scade', async () => {
		const page = fakePage();
		const doc = page.dom.window.document;
		doc.querySelector('#buybox').insertAdjacentHTML('beforebegin', '<div id="availability">Non disponibile</div>');
		Object.assign(page, {
			setViewport: async () => {}, setUserAgent: async () => {}, setExtraHTTPHeaders: async () => {},
			setRequestInterception: async () => {}, on: () => {}, goto: async () => {}, url: () => url,
			title: async () => doc.title, waitForFunction: async () => {},
			evaluate: async (fn, arg) => page.dom.window.eval(`(${fn.toString()})`)(arg),
		});
		const out = await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 30000, maxRetries: 0,
			createBrowserImpl: async () => ({ newPage: async () => page, close: async () => {} }) });
		expect(out.price).toBe(19.99);
		expect(out.debug.deliveryLocation).toMatchObject({ before: 'Stati Uniti', updated: true });
	});
	it('cambia la posizione con le chiamate del selettore, senza dipendere dal pulsante', async () => {
		const page = fakePage({ confirm: false });
		const win = page.dom.window;
		win.document.body.insertAdjacentHTML('beforeend', `<span id="nav-global-location-data-modal-action" data-a-modal='{"url":"/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Detail&storeContext=beauty","ajaxHeaders":{"anti-csrftoken-a2z":"MODAL"}}'></span>`);
		const calls = [];
		win.fetch = async (target, options = {}) => {
			calls.push({ target, options });
			if (String(target).includes('get-rendered-address-selections')) return { ok: true, status: 200, text: async () => '<script>P.when("A").execute(function(A){ var CSRF_TOKEN : "ADDRESS"; })</script>' };
			return { ok: true, status: 200, json: async () => ({ isValidAddress: 1, isAddressUpdated: 1 }) };
		};
		const out = await scraper.setAmazonDeliveryLocation(page, url, 20000);
		expect(out).toMatchObject({ updated: true, method: 'api', after: 'Milano 20121' });
		expect(calls[0].options.headers['anti-csrftoken-a2z']).toBe('MODAL');
		expect(calls[1].options.headers['anti-csrftoken-a2z']).toBe('ADDRESS');
		expect(JSON.parse(calls[1].options.body)).toMatchObject({ zipCode: '20121', storeContext: 'beauty', locationType: 'LOCATION_INPUT' });
		expect(page.typed).toEqual([]);
	});
	it('un indirizzo rifiutato da Amazon non viene dato per applicato', async () => {
		const page = fakePage({ confirm: false });
		const win = page.dom.window;
		win.document.body.insertAdjacentHTML('beforeend', `<span id="nav-global-location-data-modal-action" data-a-modal='{"url":"/m","ajaxHeaders":{}}'></span>`);
		win.fetch = async target => (String(target) === '/m'
			? { ok: true, status: 200, text: async () => 'CSRF_TOKEN : "T"' }
			: { ok: true, status: 200, json: async () => ({ isValidAddress: 0, isAddressUpdated: 0 }) });
		const out = await scraper.setAmazonDeliveryLocation(page, url, 20000);
		expect(out.updated).toBe(false);
		expect(out.steps[0]).toContain('indirizzo_rifiutato');
	});
	it('una ricarica lenta dopo il cambio confermato non annulla il cambio e non ripete il clic', async () => {
		const page = fakePage({ confirm: false });
		const win = page.dom.window;
		win.document.body.insertAdjacentHTML('beforeend', `<span id="nav-global-location-data-modal-action" data-a-modal='{"url":"/m","ajaxHeaders":{}}'></span>`);
		win.fetch = async target => (String(target) === '/m'
			? { ok: true, status: 200, text: async () => 'CSRF_TOKEN : "T"' }
			: { ok: true, status: 200, json: async () => ({ isValidAddress: 1, isAddressUpdated: 1 }) });
		const reloadDone = page.reload;
		page.reload = vi.fn(async options => {
			await reloadDone();
			throw Object.assign(new Error(`Navigation timeout of ${options.timeout} ms exceeded`), { name: 'TimeoutError' });
		});
		const out = await scraper.setAmazonDeliveryLocation(page, url, 40000);
		expect(out).toMatchObject({ updated: true, method: 'api', error: null, after: 'Milano 20121' });
		expect(page.reload.mock.calls[0][0].timeout).toBeGreaterThan(10000);
		expect(out.steps.at(-1)).toContain('ricarica: timeout');
		expect(page.typed).toEqual([]);
	});
});

