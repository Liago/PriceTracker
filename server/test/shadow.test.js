import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import shadowModule from '../scrape/shadow.js';
import pipelineModule from '../scrape/pipeline.js';
import { FakePage } from './helpers/fakePage.js';
import MediaWorldScraper from '../services/scrapers/MediaWorldScraper.js';
import BackMarketScraper from '../services/scrapers/BackMarketScraper.js';

const { compareResults, summarize, AGREEMENT } = shadowModule;
const { runPipeline } = pipelineModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (store, name) => readFileSync(path.join(here, 'fixtures', store, name), 'utf-8');

const pipelineOf = (price, extra = {}) => ({
	result: { price, ...extra },
	fields: { price: { source: 'jsonld' } },
	confidence: 0.9,
	signals: [],
});

describe('compareResults - classificazione dell\'accordo', () => {
	it('riconosce l\'accordo', () => {
		const out = compareResults({ legacy: { price: '729,00 €' }, pipeline: pipelineOf(729) });
		expect(out.agreement).toBe(AGREEMENT.MATCH);
		expect(out.deltaPct).toBe(0);
	});

	it('tollera differenze di arrotondamento', () => {
		const out = compareResults({ legacy: { price: '729,00' }, pipeline: pipelineOf(729.001) });
		expect(out.agreement).toBe(AGREEMENT.MATCH);
	});

	it('riconosce il disaccordo e ne misura l\'entita\'', () => {
		const out = compareResults({ legacy: { price: '899,00 €' }, pipeline: pipelineOf(729) });
		expect(out.agreement).toBe(AGREEMENT.MISMATCH);
		expect(out.deltaPct).toBeCloseTo(18.91, 1);
	});

	it('distingue chi dei due ha trovato un prezzo', () => {
		expect(compareResults({ legacy: { price: '729,00' }, pipeline: pipelineOf(null) }).agreement)
			.toBe(AGREEMENT.LEGACY_ONLY);
		expect(compareResults({ legacy: { price: 'Non disponibile' }, pipeline: pipelineOf(729) }).agreement)
			.toBe(AGREEMENT.PIPELINE_ONLY);
		expect(compareResults({ legacy: {}, pipeline: pipelineOf(null) }).agreement)
			.toBe(AGREEMENT.BOTH_FAILED);
	});

	it('registra provenienza e confidenza per l\'analisi successiva', () => {
		const out = compareResults({
			legacy: { price: '729,00 €', debug: { strategy: 'MediaWorldScraper' } },
			pipeline: pipelineOf(729),
			url: 'https://x.it/p',
		});

		expect(out.legacyStrategy).toBe('MediaWorldScraper');
		expect(out.pipelineSource).toBe('jsonld');
		expect(out.pipelineConfidence).toBe(0.9);
		expect(out.url).toBe('https://x.it/p');
	});

	it('segnala le differenze sui campi non numerici', () => {
		const out = compareResults({
			legacy: { price: '729,00', title: 'Titolo vecchio', image: 'https://x.it/a.jpg' },
			pipeline: pipelineOf(729, { title: 'Titolo nuovo', image: 'https://x.it/a.jpg' }),
		});

		expect(out.fieldDiffs.title).toEqual({ legacy: 'Titolo vecchio', pipeline: 'Titolo nuovo' });
		expect(out.fieldDiffs.image).toBeUndefined();
		expect(out.fieldDiffCount).toBe(1);
	});

	it('regge input mancanti senza sollevare eccezioni', () => {
		expect(() => compareResults({ legacy: null, pipeline: null })).not.toThrow();
		expect(compareResults({ legacy: null, pipeline: null }).agreement).toBe(AGREEMENT.BOTH_FAILED);
	});
});

describe('summarize - il criterio di uscita della fase 2', () => {
	const comparison = (agreement, confidence = 0.9) => ({ agreement, pipelineConfidence: confidence });

	it('calcola il tasso di accordo', () => {
		const out = summarize([
			comparison(AGREEMENT.MATCH), comparison(AGREEMENT.MATCH),
			comparison(AGREEMENT.MATCH), comparison(AGREEMENT.MISMATCH),
		]);

		expect(out.agreementRate).toBe(75);
		expect(out.total).toBe(4);
	});

	it('esclude dal denominatore i casi in cui falliscono entrambi', () => {
		// Se nessuno dei due trova un prezzo non c'e' accordo da misurare:
		// tenerli dentro gonfierebbe o sgonfierebbe il tasso a caso.
		const out = summarize([
			comparison(AGREEMENT.MATCH), comparison(AGREEMENT.MATCH),
			comparison(AGREEMENT.BOTH_FAILED), comparison(AGREEMENT.BOTH_FAILED),
		]);

		expect(out.comparable).toBe(2);
		expect(out.agreementRate).toBe(100);
	});

	it('raccoglie i casi da ispezionare a mano', () => {
		const out = summarize([
			comparison(AGREEMENT.MATCH),
			comparison(AGREEMENT.MISMATCH),
			comparison(AGREEMENT.LEGACY_ONLY),
			comparison(AGREEMENT.PIPELINE_ONLY),
		]);

		// Disaccordo e regressione vanno guardati; un prezzo trovato solo dalla
		// pipeline e' un miglioramento, non un problema.
		expect(out.toReview).toHaveLength(2);
	});

	it('riporta la confidenza mediana', () => {
		const out = summarize([comparison(AGREEMENT.MATCH, 0.5), comparison(AGREEMENT.MATCH, 0.9), comparison(AGREEMENT.MATCH, 0.95)]);
		expect(out.medianConfidence).toBe(0.9);
	});

	it('regge un elenco vuoto', () => {
		const out = summarize([]);
		expect(out.agreementRate).toBeNull();
		expect(out.total).toBe(0);
	});
});

describe('shadow - confronto reale scraper dedicato contro pipeline', () => {
	async function compareOnFixture(store, name, url, ScraperClass = MediaWorldScraper) {
		const html = fixture(store, name);
		const page = new FakePage(html, { url });
		try {
			const legacy = await new ScraperClass(page).scrape(url);
			const pipeline = runPipeline(html, { url });
			return compareResults({ legacy, pipeline, url });
		} finally {
			page.close();
		}
	}

	it('lo scraper MediaWorld e la pipeline concordano sul prezzo', async () => {
		const out = await compareOnFixture('mediaworld', 'product-in-stock.html', 'https://www.mediaworld.it/p');
		expect(out.agreement).toBe(AGREEMENT.MATCH);
		expect(out.pipelinePrice).toBe(729);
	});

	it('concordano anche sul prodotto esaurito', async () => {
		const out = await compareOnFixture('mediaworld', 'product-out-of-stock.html', 'https://www.mediaworld.it/p');
		expect(out.agreement).toBe(AGREEMENT.MATCH);
		expect(out.pipelinePrice).toBe(299.99);
	});

	it('lo scraper BackMarket e la pipeline concordano', async () => {
		const out = await compareOnFixture(
			'backmarket', 'product-in-stock.html',
			'https://www.backmarket.it/p', BackMarketScraper,
		);
		expect(out.agreement).toBe(AGREEMENT.MATCH);
		expect(out.pipelinePrice).toBe(379);
	});

	it('su tutte le fixture con scraper dedicato l\'accordo e\' totale', async () => {
		// E' il criterio di uscita della fase 2, per quanto sia verificabile
		// senza traffico reale: la misura che conta davvero va fatta in
		// produzione con lo shadow mode acceso, su prodotti veri.
		const cases = [
			['mediaworld', 'product-in-stock.html', 'https://www.mediaworld.it/p', MediaWorldScraper],
			['mediaworld', 'product-out-of-stock.html', 'https://www.mediaworld.it/p', MediaWorldScraper],
			['backmarket', 'product-in-stock.html', 'https://www.backmarket.it/p', BackMarketScraper],
		];

		const comparisons = [];
		for (const [store, name, url, ScraperClass] of cases) {
			comparisons.push(await compareOnFixture(store, name, url, ScraperClass));
		}

		const summary = summarize(comparisons);
		expect(summary.agreementRate).toBe(100);
		expect(summary.toReview).toHaveLength(0);
		expect(summary.medianConfidence).toBeGreaterThanOrEqual(0.85);
	});
});
