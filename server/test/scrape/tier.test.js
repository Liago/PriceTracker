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

/**
 * Il tier 1 non aveva l'ispezione che il tier 0 aveva gia'.
 *
 * In produzione e' successo esattamente questo: la GET rifiutata con un blocco,
 * il browser avviato con poco tempo, la navigazione in timeout, page.content()
 * che restituisce il guscio vuoto del documento e la pipeline che ci trova
 * zero candidati. Quel nulla diventava «questa pagina non ha un prezzo».
 */
describe('inspectResult - la regola vale per entrambi i tier', () => {
	const { inspectResult } = scraperModule;
	const full = { reason: null, bytes: 40000 };
	const tiny = { reason: 'pagina_troppo_piccola', bytes: 120 };

	it('zero candidati non e’ un risultato, comunque sia arrivata la pagina', () => {
		expect(inspectResult({ candidates: [] }, full)).toEqual({ usable: false, reason: 'nessun_candidato' });
	});

	it('una pagina minuscola senza candidato prezzo non e’ un risultato', () => {
		const data = { candidates: [{ field: 'title', value: 'x' }] };
		expect(inspectResult(data, tiny)).toEqual({ usable: false, reason: 'pagina_troppo_piccola' });
	});

	it('ma se un prezzo c’e’, la dimensione non conta: le fixture sono piccole', () => {
		const data = { candidates: [{ field: 'price', value: 199 }] };
		expect(inspectResult(data, tiny).usable).toBe(true);
	});

	it('una pagina piena senza prezzo e’ un risultato: sara’ chi chiama a giudicarlo', () => {
		// Esaurito, prezzo su richiesta: casi legittimi, non letture fallite.
		const data = { candidates: [{ field: 'title', value: 'Prodotto' }] };
		expect(inspectResult(data, full).usable).toBe(true);
	});
});

describe('browserReachability - i tre gradi, non due', () => {
	const { browserReachability } = scraperModule;

	it('con i default il browser e’ raggiungibile solo se il tier 0 rinuncia in fretta', () => {
		// E' il caso osservato in produzione: la GET viene rifiutata con un
		// blocco in poche centinaia di millisecondi, quindi il residuo basta.
		// Dire «non parte mai», come faceva la prima versione, era falso.
		expect(browserReachability().level).toBe('condizionato');
	});
});

/**
 * Il transport della ricetta esisteva gia' nello schema e non veniva letto.
 *
 * Su un dominio che rifiuta le richieste senza browser, la GET e' tempo tolto
 * al browser per riprendersi lo stesso 403 di ogni volta: in produzione
 * settecento millisecondi su novemila di budget.
 */
describe('scrapeProduct - la ricetta dice con quale trasporto si legge', () => {
	it('con transport "browser" il tier 0 non viene nemmeno tentato', async () => {
		let tentato = false;
		const impl = async () => { tentato = true; return { ok: false, reason: 'x', durationMs: 1 }; };

		await expect(scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: impl,
			recipe: { transport: 'browser', fields: {} },
			budgetMs: 1200, // troppo poco per il browser: fallisce subito
		})).rejects.toMatchObject({ code: BUDGET_EXCEEDED });

		expect(tentato).toBe(false);
	});

	it('ma se il browser non e’ disponibile il tier 0 si tenta comunque', async () => {
		// Meglio una lettura HTTP incerta che nessuna lettura: il transport e'
		// un'indicazione di costo, non un divieto.
		const data = await scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: servesHtml(fixture('backmarket', 'product-in-stock.html')),
			recipe: { transport: 'browser', fields: {} },
			allowBrowser: false,
		});

		expect(data.priceValue).toBeGreaterThan(0);
		expect(data.debug.tier).toBe(0);
	});

	it('con transport "http" il tier 0 resta la prima scelta', async () => {
		const data = await scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: servesHtml(fixture('backmarket', 'product-in-stock.html')),
			recipe: { transport: 'http', fields: {} },
			allowBrowser: false,
		});

		expect(data.debug.tier).toBe(0);
	});
});

describe('scrapeProduct - l’errore dice a che tier si e’ arrivati', () => {
	it('il tier e’ tracciato, non dedotto dai campi presenti', async () => {
		// Con budget minimo il browser non parte: il tier resta 0, e stavolta
		// perche' e' vero, non perche' mancava l'HTML da cui dedurlo.
		const promise = scrapeProduct(BACKMARKET_URL, {
			fetchHtmlImpl: refuses('bloccato_dal_sito', true),
			budgetMs: 1100,
		});

		await expect(promise).rejects.toMatchObject({ tier: 0, reason: 'budget_esaurito' });
	});

	it('anche un tentativo fallito riporta la propria durata', async () => {
		try {
			await scrapeProduct(BACKMARKET_URL, { fetchHtmlImpl: refuses('timeout'), budgetMs: 1100 });
			throw new Error('doveva fallire');
		} catch (error) {
			expect(error.totalMs).toBeGreaterThanOrEqual(0);
			expect(error.totalMs).toBeLessThan(3000);
		}
	});
});

/**
 * Il caso osservato su tre domini diversi: la GET rifiutata con 403 e il
 * browser che riceve una pagina di sfida.
 */
describe('quando il sito serve una sfida anche al browser', () => {
	const { browserBudgetNeeded, retryDelay } = scraperModule;

	it('sulla sfida si riprova subito, non dopo un backoff', () => {
		// Il backoff esponenziale serve ad aspettare che un servizio
		// sovraccarico si riprenda. Qui non si aspetta niente: si cambia
		// User-Agent, ed è immediato. Due secondi di attesa consumerebbero il
		// budget che serve al tentativo stesso.
		const challenge = retryDelay(new Error('CAPTCHA_DETECTED:DataDome'), 0)
		expect(challenge).toBeLessThanOrEqual(500);

		// Su un errore di rete il backoff resta quello di prima.
		expect(retryDelay(new Error('net::ERR_CONNECTION_RESET'), 1)).toBeGreaterThan(challenge);
	});

	it('a freddo la soglia resta la stima prudente', () => {
		// Nessun avvio ancora osservato in questo processo: la stima tarata
		// sull'avvio a freddo è quella giusta, ed è il caso in cui è giusta.
		expect(browserBudgetNeeded()).toBe(8000);
	});
});
