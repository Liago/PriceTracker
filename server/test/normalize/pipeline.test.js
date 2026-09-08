import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import engine from '../../scrape/index.js';
import normalizeResult from '../../scrape/normalizeResult.js';

const { interpret } = engine;
const { normalizeScrapeResult } = normalizeResult;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (store, name) =>
	readFileSync(path.join(here, '..', 'fixtures', store, name), 'utf-8');

/** Percorso completo: fixture HTML -> motore generico -> normalizzazione. */
function runPipeline(store, name, url) {
	return normalizeScrapeResult(interpret(fixture(store, name), { url }), url);
}

describe('pipeline: motore generico + normalizzazione', () => {
	const url = 'https://www.mediaworld.it/product/x';

	it('produce un prezzo numerico pronto per la colonna numeric(12,2)', () => {
		const result = runPipeline('mediaworld', 'product-in-stock.html', url);

		expect(result.priceValue).toBe(729);
		expect(typeof result.priceValue).toBe('number');
		expect(result.currency).toBe('EUR');
		expect(result.availability).toBe('in_stock');
	});

	it('conserva i campi che il client legge oggi', () => {
		const result = runPipeline('mediaworld', 'product-in-stock.html', url);

		expect(result.title).toBe('Apple iPhone 15 128GB Nero');
		expect(result.image).toBeTruthy();
		expect(result.store).toBe('mediaworld');
		expect(result.available).toBe(true);
	});

	it('riporta esaurito senza perdere il prezzo', () => {
		const result = runPipeline('mediaworld', 'product-out-of-stock.html', url);

		expect(result.priceValue).toBe(299.99);
		expect(result.availability).toBe('out_of_stock');
		expect(result.available).toBe(false);
	});

	it('non lascia mai il prezzo come stringa nel campo normalizzato', () => {
		for (const name of ['product-in-stock.html', 'product-out-of-stock.html']) {
			const result = runPipeline('mediaworld', name, url);
			expect(result.priceValue === null || typeof result.priceValue === 'number').toBe(true);
		}
	});
});
