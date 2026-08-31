import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FakePage } from '../helpers/fakePage.js';
import BackMarketScraper from '../../services/scrapers/BackMarketScraper.js';
import normalizeResult from '../../scrape/normalizeResult.js';

const { normalizeScrapeResult } = normalizeResult;
const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'https://www.backmarket.it/it-it/p/iphone-13/xyz';

async function scrapeFixture(name) {
	const html = readFileSync(path.join(here, '..', 'fixtures', 'backmarket', name), 'utf-8');
	const page = new FakePage(html, { url });
	try {
		return await new BackMarketScraper(page).scrape(url);
	} finally {
		page.close();
	}
}

describe('BackMarketScraper', () => {
	it('restituisce il prezzo grezzo, come gli altri scraper', async () => {
		const raw = await scrapeFixture('product-in-stock.html');

		// Prima il parsing avveniva dentro lo scraper e usciva un numero, mentre
		// ogni altro scraper produce una stringa: il campo price aveva tipo
		// diverso a seconda dello store.
		expect(typeof raw.price).toBe('string');
		expect(raw.price).toContain('379');
	});

	it('produce un prezzo corretto passando dalla normalizzazione condivisa', async () => {
		const raw = await scrapeFixture('product-in-stock.html');
		const result = normalizeScrapeResult(raw, url);

		expect(result.priceValue).toBe(379);
		expect(result.currency).toBe('EUR');
		expect(result.availability).toBe('in_stock');
		expect(result.store).toBe('backmarket');
	});

	it('estrae titolo e specifiche', async () => {
		const raw = await scrapeFixture('product-in-stock.html');

		expect(raw.title).toContain('iPhone 13');
		expect(raw.details.features).toContain("Capacita': 128 GB");
	});
});
