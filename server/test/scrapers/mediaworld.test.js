import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FakePage } from '../helpers/fakePage.js';
import MediaWorldScraper from '../../services/scrapers/MediaWorldScraper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
	readFileSync(path.join(here, '..', 'fixtures', 'mediaworld', name), 'utf-8');

async function scrapeFixture(name) {
	const page = new FakePage(fixture(name), { url: 'https://www.mediaworld.it/product/x' });
	const scraper = new MediaWorldScraper(page);
	try {
		return await scraper.scrape('https://www.mediaworld.it/product/x');
	} finally {
		page.close();
	}
}

describe('MediaWorldScraper', () => {
	it('estrae prezzo, valuta e disponibilita\' da una pagina disponibile', async () => {
		const data = await scrapeFixture('product-in-stock.html');

		expect(data.price).toBe('729.00');
		expect(data.currency).toBe('EUR');
		expect(data.available).toBe(true);
		expect(data.store).toBe('mediaworld');
	});

	it('estrae titolo e immagine dai meta Open Graph', async () => {
		const data = await scrapeFixture('product-in-stock.html');

		expect(data.title).toBe('Apple iPhone 15 128GB Nero');
		expect(data.image).toBe('https://static.mediaworld.it/img/iphone15.jpg');
	});

	it('estrae le specifiche come coppie chiave/valore', async () => {
		const data = await scrapeFixture('product-in-stock.html');

		expect(data.details.features).toContain('Display: 6,1 pollici');
		expect(data.details.features).toContain('Memoria interna: 128 GB');
	});

	it('riconosce un prodotto esaurito dal JSON-LD', async () => {
		const data = await scrapeFixture('product-out-of-stock.html');

		expect(data.price).toBe('299.99');
		expect(data.available).toBe(false);
	});
});
