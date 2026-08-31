import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import documentModule from '../../scrape/document.js';
import pipelineModule from '../../scrape/pipeline.js';
import learnerModule from '../../scrape/recipe/learner.js';
import applierModule from '../../scrape/recipe/applier.js';
import schemaModule from '../../scrape/recipe/schema.js';

const { createDocument } = documentModule;
const { runPipeline } = pipelineModule;
const { learnRecipe } = learnerModule;
const { applyRecipe } = applierModule;
const { validateRecipe } = schemaModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, '..', 'fixtures');

/** Tutte le fixture disponibili, come [store, nomeFile, url]. */
function allFixtures() {
	const cases = [];
	for (const store of readdirSync(fixturesRoot)) {
		const dir = path.join(fixturesRoot, store);
		for (const name of readdirSync(dir)) {
			if (!name.endsWith('.html')) continue;
			cases.push([store, name, `https://www.${store}.it/p`]);
		}
	}
	return cases;
}

const readFixture = (store, name) => readFileSync(path.join(fixturesRoot, store, name), 'utf-8');

/**
 * Il ciclo completo: scoperta -> ricetta -> riapplicazione sulla stessa
 * pagina. E' la prova che i parametri salvati a database bastano davvero a
 * rifare il lavoro, e non solo a descriverlo.
 */
function roundTrip(html, url) {
	const discovery = runPipeline(html, { url });
	const { recipe, reason } = learnRecipe(discovery, { url });
	if (!recipe) return { discovery, recipe: null, reason, replayed: null };

	const doc = createDocument(html, { url });
	const replayed = applyRecipe(recipe, doc);
	return { discovery, recipe, reason, replayed };
}

const valueOf = (candidates, field) => candidates.find((c) => c.field === field)?.value;

describe('round-trip - shop con dati strutturati', () => {
	const html = readFixture('generic', 'shopify-like.html');
	const url = 'https://bottega-alpina.it/prodotti/zaino';
	const { discovery, recipe, replayed } = roundTrip(html, url);

	it('produce una ricetta valida', () => {
		expect(recipe).not.toBeNull();
		expect(validateRecipe(recipe).valid).toBe(true);
		expect(recipe.domain).toBe('bottega-alpina.it');
		expect(recipe.status).toBe('candidate');
	});

	it('la ricetta riapplicata restituisce lo stesso prezzo della scoperta', () => {
		expect(discovery.result.price).toBe(149);
		expect(valueOf(replayed, 'price')).toBe(149);
	});

	it('riproduce anche valuta, disponibilita\' e identita\'', () => {
		expect(valueOf(replayed, 'currency')).toBe(discovery.result.currency);
		expect(valueOf(replayed, 'availability')).toBe(discovery.result.availability);
		expect(valueOf(replayed, 'title')).toBe(discovery.result.title);
	});

	it('registra sorgenti alternative come fallback', () => {
		// Se la strategia principale smette di funzionare dopo un redesign, la
		// ricetta ha gia' un piano B invece di tornare in scoperta completa.
		expect(recipe.fields.price.fallbacks.length).toBeGreaterThan(0);
		const strategie = recipe.fields.price.fallbacks.map((f) => f.strategy);
		expect(strategie).not.toContain(recipe.fields.price.strategy);
	});
});

describe('round-trip - shop artigianale, solo euristiche DOM', () => {
	// E' il caso che conta di piu': qui la ricetta deve salvare un SELETTORE,
	// altrimenti riapplicarla significherebbe rifare tutta l'euristica.
	const html = readFixture('generic', 'artisanal-no-structured-data.html');
	const url = 'https://bottega-legno.it/p/tagliere';
	const { discovery, recipe, replayed } = roundTrip(html, url);

	it('produce comunque una ricetta', () => {
		expect(recipe).not.toBeNull();
		expect(validateRecipe(recipe).valid).toBe(true);
	});

	it('la ricetta contiene un selettore CSS eseguibile, non una descrizione', () => {
		expect(recipe.fields.price.strategy).toBe('css');
		expect(typeof recipe.fields.price.selector).toBe('string');
		expect(recipe.fields.price.selector.length).toBeGreaterThan(0);
	});

	it('riapplicata da\' lo stesso prezzo, senza rifare l\'euristica', () => {
		expect(discovery.result.price).toBe(44.5);
		expect(valueOf(replayed, 'price')).toBe(44.5);
	});

	it('il selettore salvato punta davvero all\'elemento giusto', () => {
		const doc = createDocument(html, { url });
		const testo = doc.$(recipe.fields.price.selector).first().text();
		expect(testo).toContain('44,50');
	});
});

describe('round-trip - su tutte le fixture', () => {
	it('ogni pagina da cui si impara una ricetta la riproduce identica', () => {
		const risultati = [];

		for (const [store, name, url] of allFixtures()) {
			const html = readFixture(store, name);
			const { discovery, recipe, replayed, reason } = roundTrip(html, url);

			if (!recipe) {
				risultati.push({ store, name, esito: 'non-appresa', reason });
				continue;
			}

			const prezzoScoperto = discovery.result.price;
			const prezzoRiapplicato = valueOf(replayed, 'price');
			risultati.push({
				store, name,
				esito: prezzoRiapplicato === prezzoScoperto ? 'identico' : 'divergente',
				prezzoScoperto, prezzoRiapplicato,
			});
		}

		const divergenti = risultati.filter((r) => r.esito === 'divergente');
		expect(divergenti, JSON.stringify(divergenti, null, 2)).toHaveLength(0);

		// Almeno le pagine prodotto devono aver prodotto una ricetta.
		const apprese = risultati.filter((r) => r.esito === 'identico');
		expect(apprese.length).toBeGreaterThanOrEqual(5);
	});
});

describe('round-trip - il learner rifiuta cio\' che non sa rifare', () => {
	it('non impara sotto la soglia di confidenza', () => {
		const html = readFixture('generic', 'not-a-product-page.html');
		const { recipe, reason } = roundTrip(html, 'https://shop.it/categoria');

		expect(recipe).toBeNull();
		expect(reason).toContain('confidenza');
	});

	it('non impara senza prezzo', () => {
		const { recipe, reason } = roundTrip('<html><body>niente</body></html>', 'https://shop.it/p');
		expect(recipe).toBeNull();
		expect(reason).toBeTruthy();
	});

	it('non impara se il dominio non e\' determinabile', () => {
		const html = readFixture('generic', 'shopify-like.html');
		const discovery = runPipeline(html, { url: 'non-un-url' });
		const { recipe, reason } = learnRecipe(discovery, { url: 'non-un-url' });

		expect(recipe).toBeNull();
		expect(reason).toContain('dominio');
	});
});
