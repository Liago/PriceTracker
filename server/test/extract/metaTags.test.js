import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import metaTags from '../../scrape/extract/metaTags.js';

const { createDocument } = documentModule;
const pick = (candidates, field) => candidates.find((c) => c.field === field);
const doc = (head) => createDocument(`<html><head>${head}</head><body></body></html>`, { url: 'https://shop.example.it/p' });

describe('metaTags', () => {
	it('estrae i campi product: e og:', () => {
		const candidates = metaTags.extract(doc(`
			<meta property="og:title" content="Apple iPhone 15">
			<meta property="og:image" content="https://shop.example.it/i.jpg">
			<meta property="og:description" content="Descrizione">
			<meta property="product:price:amount" content="729.00">
			<meta property="product:price:currency" content="EUR">
			<meta property="product:availability" content="in stock">`));

		expect(pick(candidates, 'title').value).toBe('Apple iPhone 15');
		expect(pick(candidates, 'image').value).toBe('https://shop.example.it/i.jpg');
		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'currency').value).toBe('EUR');
		expect(pick(candidates, 'availability').value).toBe('in_stock');
	});

	it('ha peso basso: i meta sono spesso stantii', () => {
		const price = pick(metaTags.extract(doc('<meta property="og:price:amount" content="99.00">')), 'price');
		expect(price.weight).toBe(0.65);
	});

	it('accetta le varianti og:price', () => {
		const candidates = metaTags.extract(doc(`
			<meta property="og:price:amount" content="49.90">
			<meta property="og:price:currency" content="GBP">`));

		expect(pick(candidates, 'price').value).toBe(49.9);
		expect(pick(candidates, 'currency').value).toBe('GBP');
	});

	it('usa il titolo della pagina come ultima risorsa, con peso ancora minore', () => {
		const candidates = metaTags.extract(doc('<title>Prodotto | Store</title>'));
		const title = pick(candidates, 'title');

		expect(title.value).toBe('Prodotto | Store');
		expect(title.source).toBe('title');
		expect(title.weight).toBeLessThan(0.65);
	});

	it('preferisce og:title al titolo della pagina', () => {
		const candidates = metaTags.extract(doc('<title>Prodotto | Store</title><meta property="og:title" content="Prodotto">'));
		expect(pick(candidates, 'title').value).toBe('Prodotto');
	});

	it('restituisce un elenco vuoto su una pagina senza meta', () => {
		expect(metaTags.extract(doc(''))).toEqual([]);
	});
});
