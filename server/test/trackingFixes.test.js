import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import engine from '../scrape/index.js';
import readiness from '../scrape/browserReadiness.js';
import scraper from '../services/scraper.js';
import dispatch from '../services/importDispatch.js';
import checker from '../services/productChecker.js';
import worker from '../../netlify/functions/worker.js';

const url = 'https://www.amazon.it/dp/B09K48BMV8';
const page = body => `<html><head><title>Zeiss</title></head><body><h1 id="productTitle">Zeiss 200 salviette</h1>
<img id="landingImage" src="https://example.com/z.jpg"><div id="availability">Disponibilità immediata</div>${body}</body></html>`;
// Markup attuale del prezzo da pagare: `.a-offscreen` vuoto, prezzo nei nodi visibili.
const modern = (whole, fraction, symbol = '€') => `<div id="corePriceDisplay_desktop_feature_div"><div class="a-section aok-align-center aok-relative">
<span class="aok-offscreen"> ${whole}${fraction} ${symbol} con 33 percento risparmio </span>
<span class="a-price aok-align-center reinventPricePriceToPayMargin priceToPay" data-a-size="xl"><span class="a-offscreen"> </span>
<span aria-hidden="true"><span class="a-price-whole">${whole}<span class="a-price-decimal">,</span></span><span class="a-price-fraction">${fraction}</span><span class="a-price-symbol">${symbol}</span></span></span>
</div><div class="a-section"><span aria-hidden="true" class="basisPrice">Prezzo consigliato: <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">29,99 €</span><span aria-hidden="true">29,99 €</span></span></span></div></div>`;

describe('Amazon: prezzo principale con a-offscreen vuoto', () => {
	it('ricompone il prezzo dai nodi visibili e ignora il prezzo consigliato barrato', () => {
		const out = engine.interpret(page(modern('19', '99')), { url });
		expect(out.price).toBe(19.99);
		expect(out.currency).toBe('EUR');
		expect(out.priceStatus).toBeNull();
		expect(out.confidence).toBeGreaterThanOrEqual(0.85);
	});
	it('non scambia i separatori delle migliaia per decimali', () => {
		expect(engine.interpret(page(modern('1.299', '00')), { url }).price).toBe(1299);
	});
	it('la readiness del browser riconosce lo stesso markup invece di attendere fino al timeout', () => {
		const dom = new JSDOM(page(modern('19', '99')), { url, runScripts: 'outside-only' });
		expect(dom.window.eval(`(${readiness.productReady.toString()})()`)).toBe(true);
		dom.window.close();
	});
	it('la pagina viene richiesta con la variante confermata, l\'URL salvato resta canonico', async () => {
		let requested;
		const html = page(modern('19', '99'));
		const out = await scraper.scrapeProduct('https://www.amazon.it/Zeiss/dp/B09K48BMV8/ref=sr_1?th=1&psc=1', {
			budgetMs: 1500, allowBrowser: false,
			fetchHtmlImpl: async target => { requested = target; return { ok: true, html, url: target, durationMs: 1 }; },
		});
		expect(requested).toBe(`${url}?psc=1`);
		expect(out.offer.url).toBe(url);
		expect(out.price).toBe(19.99);
	});
});

describe('avvio delle background function', () => {
	it('non dipende da NETLIFY=true, che a runtime puo\' mancare', async () => {
		const request = vi.fn(async () => ({ status: 202 }));
		await dispatch.dispatchImport('job', { env: { URL: 'https://app.example', SUPABASE_SERVICE_ROLE_KEY: 'k' }, request });
		expect(request.mock.calls[0][0].href).toBe('https://app.example/.netlify/functions/product-import-background');
	});
	it('firma anche le invocazioni senza job specifico', async () => {
		const env = { URL: 'https://app.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
		const request = vi.fn(async () => ({ status: 202 }));
		await dispatch.invokeBackground('scrape-worker-background', {}, { env, request });
		const { body, headers } = request.mock.calls[0][1];
		expect(dispatch.verifyInvocation(body, headers['X-Import-Signature'], env, { requireId: false })).not.toBeNull();
		expect(dispatch.verifyInvocation(body, headers['X-Import-Signature'], env)).toBeNull();
	});
	it('la function schedulata esegue il lotto da se\' se il background non parte', async () => {
		const inline = vi.fn(async () => ({ statusCode: 200 }));
		const handler = worker.createScheduledHandler({ invoke: async () => { throw new Error('HTTP 404'); }, inline });
		expect((await handler()).statusCode).toBe(200);
		expect(inline).toHaveBeenCalledOnce();
		const delegated = worker.createScheduledHandler({ invoke: async () => {}, inline: vi.fn() });
		expect((await delegated()).statusCode).toBe(202);
	});
});

describe('conferma di un cambio di prezzo nel tempo', () => {
	const product = { id: 'p1', url: 'https://shop.example/tv', current_price: 1000, currency: 'EUR', consecutive_failures: 1 };
	const history = [{ price: 1000, observedAt: new Date().toISOString() }];
	const scraped = { price: 349, currency: 'EUR', availability: 'in_stock', confidence: 0.86, fields: { price: { source: 'jsonld' } } };
	const repo = recent => {
		const commits = [];
		return { commits, getReference: async () => ({ offer: null, history, recent }), commitCheck: async args => { commits.push(args); return { priceChanged: true }; } };
	};

	it('al primo controllo un calo del 65% resta da confermare', async () => {
		const r = repo([]);
		const out = await checker.checkProduct({ product, repo: r, scrape: async () => scraped });
		expect(out.accepted).toBe(false);
		expect(out.reasons).toContain('variazione_implausibile');
	});
	it('lo stesso prezzo letto anche al controllo successivo viene accettato', async () => {
		const r = repo([{ price: 349, currency: 'EUR', accepted: false, rejectReason: 'variazione_implausibile' }]);
		const out = await checker.checkProduct({ product, repo: r, scrape: async () => scraped });
		expect(out.accepted).toBe(true);
		expect(r.commits[0].patch.current_price).toBe(349);
	});
	it('non conferma un prezzo diverso, ne\' uno respinto per altri motivi', () => {
		const reading = { price: 349, currency: 'EUR' };
		expect(checker.confirmedOverTime(reading, [{ price: 350, currency: 'EUR', accepted: false, rejectReason: 'variazione_implausibile' }])).toBe(false);
		expect(checker.confirmedOverTime(reading, [{ price: 349, currency: 'EUR', accepted: false, rejectReason: 'variazione_implausibile,identita_cambiata' }])).toBe(false);
		expect(checker.confirmedOverTime(reading, [{ price: 349, currency: 'EUR', accepted: true }])).toBe(false);
	});
});
