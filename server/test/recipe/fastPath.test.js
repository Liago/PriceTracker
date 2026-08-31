import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pipelineModule from '../../scrape/pipeline.js';
import learnerModule from '../../scrape/recipe/learner.js';

const { runPipeline } = pipelineModule;
const { learnRecipe } = learnerModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, '..', 'fixtures', 'generic', name), 'utf-8');

const url = 'https://bottega-alpina.it/prodotti/zaino';
const html = fixture('shopify-like.html');

/** Ricetta collaudata, come sarebbe dopo qualche successo. */
function recipeFor(fixtureName, pageUrl) {
	const discovery = runPipeline(fixture(fixtureName), { url: pageUrl });
	const { recipe } = learnRecipe(discovery, { url: pageUrl });
	return { ...recipe, id: 'r1', version: 3, success_count: 10, status: 'active' };
}

describe('fast path', () => {
	it('con una ricetta collaudata salta la scoperta', () => {
		const out = runPipeline(html, { url, recipe: recipeFor('shopify-like.html', url) });

		expect(out.usedFastPath).toBe(true);
		expect(out.result.price).toBe(149);
		expect(out.extractorsRan.map((e) => e.name)).toEqual(['recipe']);
		expect(out.signals).toContain('fast-path');
	});

	it('riporta quale ricetta ha usato', () => {
		const out = runPipeline(html, { url, recipe: recipeFor('shopify-like.html', url) });
		expect(out.recipeId).toBe('r1');
		expect(out.recipeVersion).toBe(3);
	});

	it('da\' lo stesso prezzo della scoperta completa', () => {
		const completa = runPipeline(html, { url });
		const veloce = runPipeline(html, { url, recipe: recipeFor('shopify-like.html', url) });
		expect(veloce.result.price).toBe(completa.result.price);
	});

	it('esegue meno lavoro della scoperta completa', () => {
		const completa = runPipeline(html, { url });
		const veloce = runPipeline(html, { url, recipe: recipeFor('shopify-like.html', url) });

		expect(veloce.extractorsRan).toHaveLength(1);
		expect(completa.extractorsRan).toHaveLength(6);
	});
});

describe('fast path - ricadute sulla scoperta', () => {
	it('una ricetta che non trova piu\' nulla non impedisce la scoperta', () => {
		// E' il caso del redesign dello store: la ricetta smette di funzionare
		// e il motore deve ripiegare da solo, non restituire un fallimento.
		const rotta = {
			id: 'r1', version: 1, success_count: 10, domain: 'bottega-alpina.it',
			fields: { price: { strategy: 'css', selector: '.selettore-che-non-esiste-piu', attr: null } },
		};
		const out = runPipeline(html, { url, recipe: rotta });

		expect(out.usedFastPath).toBe(false);
		expect(out.result.price).toBe(149);
		expect(out.extractorsRan.map((e) => e.name)).toContain('jsonld');
	});

	it('registra comunque il tentativo con la ricetta', () => {
		const rotta = {
			id: 'r1', domain: 'bottega-alpina.it',
			fields: { price: { strategy: 'css', selector: '.assente', attr: null } },
		};
		const out = runPipeline(html, { url, recipe: rotta });

		const tentativo = out.extractorsRan.find((e) => e.name === 'recipe');
		expect(tentativo).toBeDefined();
		expect(tentativo.candidates).toBe(0);
	});

	it('una ricetta che trova un valore ma con confidenza bassa passa alla scoperta', () => {
		// Solo il prezzo, nessuna identita': la riconciliazione penalizza e la
		// confidenza resta sotto soglia. Meglio verificare che fidarsi.
		const debole = {
			id: 'r1', domain: 'bottega-alpina.it', success_count: 0,
			fields: { price: { strategy: 'css', selector: '.price--sale', attr: null } },
		};
		const out = runPipeline(html, { url, recipe: debole });

		expect(out.usedFastPath).toBe(false);
		expect(out.extractorsRan.length).toBeGreaterThan(1);
	});

	it('una ricetta che solleva un\'eccezione viene registrata e superata', () => {
		const malformata = { id: 'r1', domain: 'x.it', fields: { price: { strategy: 'css', selector: '<<<', attr: null } } };
		const out = runPipeline(html, { url, recipe: malformata });

		expect(out.result.price).toBe(149);
		expect(out.extractorsRan.find((e) => e.name === 'recipe')).toBeDefined();
	});

	it('senza ricetta si comporta come prima', () => {
		const out = runPipeline(html, { url });
		expect(out.usedFastPath).toBe(false);
		expect(out.recipeId).toBeNull();
		expect(out.result.price).toBe(149);
	});
});

describe('fast path - shop artigianale', () => {
	const artUrl = 'https://bottega-legno.it/p/tagliere';

	it('la ricetta DOM riapplicata trova il prezzo senza rifare l\'euristica', () => {
		const recipe = recipeFor('artisanal-no-structured-data.html', artUrl);
		const out = runPipeline(fixture('artisanal-no-structured-data.html'), { url: artUrl, recipe });

		expect(out.result.price).toBe(44.5);
		// La ricetta include titolo e immagine, quindi la riconciliazione non
		// penalizza e il fast path regge anche qui.
		expect(out.usedFastPath).toBe(true);
	});
});
