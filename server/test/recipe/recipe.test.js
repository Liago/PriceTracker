import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import schemaModule from '../../scrape/recipe/schema.js';
import learnerModule from '../../scrape/recipe/learner.js';
import applierModule from '../../scrape/recipe/applier.js';

const { createDocument } = documentModule;
const { validateRecipe } = schemaModule;
const { nextRecipeState, domainOf } = learnerModule;
const { applyRecipe } = applierModule;

const valid = () => ({
	domain: 'shop.it',
	fields: { price: { strategy: 'css', selector: '.price', attr: null } },
});

describe('validateRecipe', () => {
	it('accetta una ricetta minima valida', () => {
		expect(validateRecipe(valid()).valid).toBe(true);
	});

	it('richiede il dominio', () => {
		const { valid: ok, errors } = validateRecipe({ ...valid(), domain: '' });
		expect(ok).toBe(false);
		expect(errors.join()).toContain('domain');
	});

	it('richiede il campo prezzo: una ricetta senza prezzo e\' inutile', () => {
		const { valid: ok, errors } = validateRecipe({ domain: 'shop.it', fields: { title: { strategy: 'css', selector: 'h1' } } });
		expect(ok).toBe(false);
		expect(errors.join()).toContain('fields.price');
	});

	it('rifiuta una strategia sconosciuta', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'telepatia' } } };
		expect(validateRecipe(recipe).errors.join()).toContain('telepatia');
	});

	it('richiede il selettore per la strategia css', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'css' } } };
		expect(validateRecipe(recipe).errors.join()).toContain('selector');
	});

	it('richiede la chiave per la strategia meta', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'meta' } } };
		expect(validateRecipe(recipe).errors.join()).toContain('key');
	});

	it('valida anche i fallback', () => {
		const recipe = {
			domain: 'shop.it',
			fields: { price: { strategy: 'jsonld', fallbacks: [{ strategy: 'css' }] } },
		};
		expect(validateRecipe(recipe).errors.join()).toContain('fallbacks[0].selector');
	});

	it('rifiuta status e origin fuori dagli enum', () => {
		expect(validateRecipe({ ...valid(), status: 'boh' }).valid).toBe(false);
		expect(validateRecipe({ ...valid(), origin: 'magia' }).valid).toBe(false);
	});

	it('rifiuta input non oggetto', () => {
		expect(validateRecipe(null).valid).toBe(false);
		expect(validateRecipe('ricetta').valid).toBe(false);
	});
});

describe('domainOf', () => {
	it('normalizza il dominio togliendo il www', () => {
		expect(domainOf('https://www.mediaworld.it/p/x')).toBe('mediaworld.it');
		expect(domainOf('https://shop.example.co.uk/p')).toBe('shop.example.co.uk');
	});

	it('restituisce null su URL non validi', () => {
		expect(domainOf('non-un-url')).toBeNull();
		expect(domainOf(null)).toBeNull();
	});
});

describe('nextRecipeState - promozione e quarantena', () => {
	it('una candidate diventa attiva dopo tre successi, non prima', () => {
		// La protezione contro l'apprendimento di un errore occasionale, che
		// verrebbe poi riapplicato a ogni check.
		let state = { status: 'candidate', success_count: 0, failure_count: 0, consecutive_failures: 0 };

		state = toRecipe(nextRecipeState(state, true));
		expect(state.status).toBe('candidate');
		state = toRecipe(nextRecipeState(state, true));
		expect(state.status).toBe('candidate');
		state = toRecipe(nextRecipeState(state, true));
		expect(state.status).toBe('active');
	});

	it('tre fallimenti consecutivi mandano in quarantena', () => {
		let state = { status: 'active', success_count: 10, failure_count: 0, consecutive_failures: 0 };

		state = toRecipe(nextRecipeState(state, false));
		expect(state.status).toBe('active');
		state = toRecipe(nextRecipeState(state, false));
		expect(state.status).toBe('active');
		state = toRecipe(nextRecipeState(state, false));
		expect(state.status).toBe('quarantined');
	});

	it('un successo azzera i fallimenti consecutivi', () => {
		const state = { status: 'active', success_count: 5, failure_count: 2, consecutive_failures: 2 };
		expect(nextRecipeState(state, true).consecutiveFailures).toBe(0);
	});

	it('una ricetta in quarantena torna in prova, non subito in produzione', () => {
		const state = { status: 'quarantined', success_count: 5, failure_count: 3, consecutive_failures: 3 };
		expect(nextRecipeState(state, true).status).toBe('candidate');
	});

	it('segnala se lo stato e\' cambiato', () => {
		const stabile = { status: 'active', success_count: 10, failure_count: 0, consecutive_failures: 0 };
		expect(nextRecipeState(stabile, true).changed).toBe(false);
	});
});

/** Riporta l'uscita di nextRecipeState nella forma di una riga di ricetta. */
function toRecipe(next) {
	return {
		status: next.status,
		success_count: next.successCount,
		failure_count: next.failureCount,
		consecutive_failures: next.consecutiveFailures,
	};
}

describe('applyRecipe', () => {
	const doc = (body) => createDocument(`<html><head>
		<meta property="product:price:amount" content="99.00">
	</head><body>${body}</body></html>`, { url: 'https://shop.it/p' });

	it('legge un prezzo con un selettore CSS', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'css', selector: '.p', attr: null } } };
		const found = applyRecipe(recipe, doc('<div class="p">729,00 €</div>'));
		expect(found.find((c) => c.field === 'price').value).toBe(729);
	});

	it('legge un attributo quando la ricetta lo indica', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'css', selector: '.p', attr: 'content' } } };
		const found = applyRecipe(recipe, doc('<div class="p" content="729.00">altro testo</div>'));
		expect(found.find((c) => c.field === 'price').value).toBe(729);
	});

	it('legge un meta tag', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'meta', key: 'product:price:amount' } } };
		expect(applyRecipe(recipe, doc('')).find((c) => c.field === 'price').value).toBe(99);
	});

	it('passa al fallback quando la strategia principale non trova nulla', () => {
		const recipe = {
			domain: 'shop.it',
			fields: {
				price: {
					strategy: 'css', selector: '.non-esiste', attr: null,
					fallbacks: [{ strategy: 'meta', key: 'product:price:amount' }],
				},
			},
		};
		const found = applyRecipe(recipe, doc('')).find((c) => c.field === 'price');

		expect(found.value).toBe(99);
		expect(found.meta.viaFallback).toBe(true);
	});

	it('il peso cresce con lo storico di successi della ricetta', () => {
		const fields = { price: { strategy: 'css', selector: '.p', attr: null } };
		const page = doc('<div class="p">10,00 €</div>');

		const nuova = applyRecipe({ domain: 'x', fields, success_count: 0 }, page)[0];
		const collaudata = applyRecipe({ domain: 'x', fields, success_count: 20 }, page)[0];

		expect(collaudata.weight).toBeGreaterThan(nuova.weight);
		expect(collaudata.weight).toBe(0.95);
	});

	it('non produce candidati se nulla corrisponde', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'css', selector: '.assente', attr: null } } };
		expect(applyRecipe(recipe, doc('<div>niente</div>'))).toEqual([]);
	});

	it('un selettore non valido non fa esplodere l\'applicazione', () => {
		const recipe = { domain: 'shop.it', fields: { price: { strategy: 'css', selector: '<<<', attr: null } } };
		expect(() => applyRecipe(recipe, doc(''))).not.toThrow();
	});

	it('regge una ricetta assente o senza campi', () => {
		expect(applyRecipe(null, doc(''))).toEqual([]);
		expect(applyRecipe({ domain: 'x' }, doc(''))).toEqual([]);
	});
});
