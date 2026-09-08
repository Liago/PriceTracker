import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import scraperModule from '../../services/scraper.js';

const { scrapeProduct, BUDGET_EXCEEDED } = scraperModule;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts) => readFileSync(join(here, '..', 'fixtures', ...parts), 'utf8');

const BACKMARKET_URL = 'https://www.backmarket.it/it-it/p/ipad-pro-2024-m4-series';

/** Tier 0 finto: consegna l'HTML che gli si dice, senza rete. */
const servesHtml = (html) => async () => ({ ok: true, html, url: BACKMARKET_URL, status: 200, durationMs: 12 });

/** Tier 0 finto che rinuncia, come davanti a un anti-bot. */
const refuses = (reason, antiBotSuspected = false) => async () => ({
	ok: false, reason, antiBotSuspected, durationMs: 8,
});

describe('scrapeProduct - il tier 0 evita il browser', () => {
	it('una pagina con dati strutturati si legge senza Chromium', async () => {
		const data = await scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: servesHtml(fixture('backmarket', 'product-in-stock.html')),
			allowBrowser: false,
		});

		expect(data.priceValue).toBeGreaterThan(0);
		expect(data.debug.tier).toBe(0);
		expect(data.debug.usedBrowser).toBe(false);
	});

	it('vale anche per MediaWorld, l’altro store della checklist', async () => {
		const data = await scrapeProduct('https://www.mediaworld.it/product/x', {
			fetchHtmlImpl: servesHtml(fixture('mediaworld', 'product-in-stock.html')),
			allowBrowser: false,
		});

		expect(data.priceValue).toBeGreaterThan(0);
		expect(data.debug.usedBrowser).toBe(false);
	});

	it('SCRAPE_TIER0=off si rispetta: con allowHttp false il tier 0 non parte', async () => {
		let called = false;
		const impl = async () => { called = true; return { ok: false, reason: 'x', durationMs: 1 }; };

		await expect(
			scrapeProduct(BACKMARKET_URL, { fetchHtmlImpl: impl, allowHttp: false, allowBrowser: false }),
		).rejects.toThrow(BUDGET_EXCEEDED);

		expect(called).toBe(false);
	});
});

describe('scrapeProduct - quando il tier 0 non basta', () => {
	it('anche uno shop artigianale senza dati strutturati si legge via HTTP', async () => {
		const data = await scrapeProduct('https://artigiano.it/p', {
			fetchHtmlImpl: servesHtml(fixture('generic', 'artisanal-no-structured-data.html')),
			allowBrowser: false,
		});

		expect(data.priceValue).toBeGreaterThan(0);
		expect(data.debug.usedBrowser).toBe(false);
	});

	it('una pagina senza prezzo resta disponibile, degradata e onesta', async () => {
		const data = await scrapeProduct('https://shop.it/chi-siamo', {
			fetchHtmlImpl: servesHtml(fixture('generic', 'not-a-product-page.html')),
			allowBrowser: false,
		});

		// Il risultato c'e' e dice la verita' sulla propria affidabilita': a
		// decidere se basta e' chi chiama, che conosce le proprie soglie.
		expect(data.debug.tier).toBe(0);
		expect(data.debug.degraded).toBe('browser_non_consentito');
		// Un numero l'ha trovato, ma non si fida: sotto la soglia del tier 0
		// sarebbe salito al browser, se glielo avessimo concesso.
		expect(data.confidence).toBeLessThan(0.6);
	});

	it('un anti-bot senza browser disponibile e’ un errore riconoscibile', async () => {
		const promise = scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: refuses('bloccato_dal_sito', true),
			allowBrowser: false,
		});

		await expect(promise).rejects.toMatchObject({
			code: BUDGET_EXCEEDED,
			antiBotSuspected: true,
			tier0Skipped: 'bloccato_dal_sito',
		});
	});

	it('un budget troppo stretto non avvia il browser: fallisce subito e lo dice', async () => {
		const started = Date.now();
		const promise = scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: refuses('timeout'),
			budgetMs: 1500,
		});

		await expect(promise).rejects.toMatchObject({ code: BUDGET_EXCEEDED, reason: 'budget_esaurito' });
		// Il punto: fallisce in fretta, invece di lasciarsi troncare dal proxy.
		expect(Date.now() - started).toBeLessThan(2000);
	});
});

describe('scrapeProduct - una sfida non e’ una pagina senza prezzo', () => {
	const CHALLENGE = '<html><head><title>Just a moment...</title></head>'
		+ '<body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>';

	it('la challenge non diventa un risultato: e’ un tentativo fallito', async () => {
		const promise = scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: servesHtml(CHALLENGE),
			allowBrowser: false,
		});

		// Il punto: senza il rilevamento, questa pagina passava per un prodotto
		// senza prezzo e l'utente si sentiva dire che era colpa del suo URL.
		await expect(promise).rejects.toMatchObject({
			code: BUDGET_EXCEEDED,
			antiBotSuspected: true,
			tier0Skipped: 'sfida_cloudflare',
		});
	});

	it('porta con se’ le prove: byte e titolo della pagina ricevuta', async () => {
		try {
			await scrapeProduct(BACKMARKET_URL, { fetchHtmlImpl: servesHtml(CHALLENGE), allowBrowser: false });
			throw new Error('doveva fallire');
		} catch (error) {
			expect(error.evidence.pageTitle).toBe('Just a moment...');
			expect(error.evidence.htmlBytes).toBeGreaterThan(0);
		}
	});

	it('una pagina vuota non produce candidati e non viene spacciata per risultato', async () => {
		const promise = scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: servesHtml('<html><head><title>x</title></head><body></body></html>'),
			allowBrowser: false,
		});

		await expect(promise).rejects.toMatchObject({
			code: BUDGET_EXCEEDED,
			tier0Skipped: 'pagina_troppo_piccola',
		});
	});
});

describe('browserReachable - la configurazione dice la verita’ su se stessa', () => {
	it('con il budget di una function sincrona il browser non e’ raggiungibile', async () => {
		const { browserReachable } = scraperModule;
		// 9000 di budget contro 6000 di tier 0 piu' 8000 di avvio: non ci sta,
		// ed e' questo il motivo per cui le pagine difficili danno 503 e non 422.
		expect(browserReachable()).toBe(false);
	});
});
