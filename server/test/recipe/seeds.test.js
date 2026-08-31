import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import seedsModule from '../../scrape/recipe/seeds.js';
import schemaModule from '../../scrape/recipe/schema.js';
import applierModule from '../../scrape/recipe/applier.js';
import documentModule from '../../scrape/document.js';
import pipelineModule from '../../scrape/pipeline.js';
import { FakePage } from '../helpers/fakePage.js';
import MediaWorldScraper from '../../services/scrapers/MediaWorldScraper.js';
import BackMarketScraper from '../../services/scrapers/BackMarketScraper.js';

const { SEEDED_RECIPES, seedFor } = seedsModule;
const { validateRecipe } = schemaModule;
const { applyRecipe } = applierModule;
const { createDocument } = documentModule;
const { runPipeline } = pipelineModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (store, name) =>
	readFileSync(path.join(here, '..', 'fixtures', store, name), 'utf-8');
const migration = readFileSync(
	path.join(here, '..', '..', 'database', 'migrations', '006_seed_recipes.sql'), 'utf-8');

describe('ricette seminate - validita\'', () => {
	it('sono 18, una per dominio oggi supportato', () => {
		expect(SEEDED_RECIPES).toHaveLength(18);
		expect(new Set(SEEDED_RECIPES.map((r) => r.domain)).size).toBe(18);
	});

	it('ognuna rispetta lo schema delle ricette', () => {
		for (const recipe of SEEDED_RECIPES) {
			const { valid, errors } = validateRecipe(recipe);
			expect(valid, `${recipe.domain}: ${errors.join('; ')}`).toBe(true);
		}
	});

	it('la strategia principale e\' sempre auto-validante', () => {
		// jsonld, microdata e meta non inventano nulla quando la pagina non le
		// espone: semplicemente non producono candidati. Un selettore CSS
		// trascritto a mano potrebbe invece agganciare l'elemento sbagliato,
		// quindi non deve mai essere la strategia principale.
		for (const recipe of SEEDED_RECIPES) {
			expect(['jsonld', 'microdata', 'meta'], recipe.domain)
				.toContain(recipe.fields.price.strategy);
		}
	});

	it('la migrazione 006 copre tutti i domini del modulo', () => {
		// Se il modulo e la migrazione divergono, il seed a database non e'
		// piu' quello che i test esercitano.
		for (const recipe of SEEDED_RECIPES) {
			expect(migration, `${recipe.domain} manca nella migrazione`).toContain(`'${recipe.domain}'`);
		}
	});
});

describe('ricette seminate - producono lo stesso risultato degli scraper dedicati', () => {
	/** Esegue lo scraper dedicato e la ricetta seminata sulla stessa fixture. */
	async function confronta(store, file, url, ScraperClass, domain) {
		const html = fixture(store, file);

		const page = new FakePage(html, { url });
		let legacy;
		try {
			legacy = await new ScraperClass(page).scrape(url);
		} finally {
			page.close();
		}

		const recipe = seedFor(domain);
		const candidates = applyRecipe(recipe, createDocument(html, { url }));

		return {
			legacyPrice: legacy.price,
			recipePrice: candidates.find((c) => c.field === 'price')?.value,
			recipeCurrency: candidates.find((c) => c.field === 'currency')?.value,
			recipeAvailability: candidates.find((c) => c.field === 'availability')?.value,
		};
	}

	it('MediaWorld: la ricetta seminata da\' lo stesso prezzo della classe', async () => {
		const out = await confronta(
			'mediaworld', 'product-in-stock.html',
			'https://www.mediaworld.it/p', MediaWorldScraper, 'mediaworld.it');

		expect(out.recipePrice).toBe(729);
		expect(Number(out.legacyPrice)).toBe(out.recipePrice);
		expect(out.recipeCurrency).toBe('EUR');
		expect(out.recipeAvailability).toBe('in_stock');
	});

	it('MediaWorld esaurito: stesso prezzo e disponibilita\' corretta', async () => {
		const out = await confronta(
			'mediaworld', 'product-out-of-stock.html',
			'https://www.mediaworld.it/p', MediaWorldScraper, 'mediaworld.it');

		expect(out.recipePrice).toBe(299.99);
		expect(out.recipeAvailability).toBe('out_of_stock');
	});

	it('BackMarket: la ricetta seminata da\' lo stesso prezzo della classe', async () => {
		const out = await confronta(
			'backmarket', 'product-in-stock.html',
			'https://www.backmarket.it/p', BackMarketScraper, 'backmarket.it');

		expect(out.recipePrice).toBe(379);
		expect(out.recipeCurrency).toBe('EUR');
	});
});

describe('ricette seminate - comportamento in caso di guasto', () => {
	it('su una pagina senza dati strutturati non producono nulla di sbagliato', () => {
		// Preferibile a un valore inventato: il motore ripiega sulla scoperta.
		const html = fixture('generic', 'artisanal-no-structured-data.html');
		const candidates = applyRecipe(seedFor('mediaworld.it'), createDocument(html, { url: 'https://x.it/p' }));

		expect(candidates.find((c) => c.field === 'price')).toBeUndefined();
	});

	it('e il motore trova comunque il prezzo passando alla scoperta', () => {
		const html = fixture('generic', 'artisanal-no-structured-data.html');
		const url = 'https://bottega-legno.it/p';
		const out = runPipeline(html, { url, recipe: seedFor('mediaworld.it') });

		expect(out.usedFastPath).toBe(false);
		expect(out.result.price).toBe(44.5);
	});
});
