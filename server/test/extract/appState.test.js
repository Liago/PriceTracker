import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import appState from '../../scrape/extract/appState.js';

const { createDocument } = documentModule;
const pick = (candidates, field) => candidates.find((c) => c.field === field);
const doc = (body) => createDocument(`<html><body>${body}</body></html>`, { url: 'https://shop.example.it/p' });

describe('appState - __NEXT_DATA__', () => {
	it('trova il prodotto per struttura, senza percorso cablato', () => {
		// Il percorso e' volutamente insolito: la ricerca deve funzionare
		// comunque, perche' cablarlo e' cio' che il refactor elimina.
		const state = {
			props: { pageProps: { dehydrated: { queries: [{ state: { data: {
				productDetail: { sku: 'ABC', name: 'iPhone 15', price: 729, currency: 'EUR', available: true },
			} } }] } } },
		};
		const candidates = appState.extract(doc(
			`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`
		));

		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'currency').value).toBe('EUR');
		expect(pick(candidates, 'title').value).toBe('iPhone 15');
		expect(pick(candidates, 'availability').value).toBe('in_stock');
	});

	it('preferisce l\'oggetto che porta anche un identificatore di prodotto', () => {
		const state = {
			config: { defaultPrice: 0.01, currency: 'EUR' },
			product: { sku: 'ABC-1', price: 729, currency: 'EUR' },
		};
		const candidates = appState.extract(doc(
			`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`
		));

		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'price').meta.hasIdentity).toBe(true);
	});

	it('ignora i prezzi accessori riconoscibili dalla chiave', () => {
		// shippingPrice, oldPrice e simili non sono il prezzo del prodotto.
		const state = {
			shipping: { shippingPrice: 4.99, currency: 'EUR' },
			pricing: { oldPrice: 899, listPrice: 999, price: 729, currency: 'EUR', sku: 'X' },
		};
		const candidates = appState.extract(doc(
			`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`
		));

		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('richiede prezzo e valuta vicini: un numero da solo non basta', () => {
		const state = { layout: { columns: 3, width: 1200 }, banner: { price: 99 } };
		const candidates = appState.extract(doc(
			`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`
		));

		expect(pick(candidates, 'price')).toBeUndefined();
	});
});

describe('appState - altri framework', () => {
	it('legge window.__NUXT__', () => {
		const candidates = appState.extract(doc(
			`<script>window.__NUXT__ = {"data":[{"product":{"sku":"A","price":"129.90","currency":"EUR"}}]};</script>`
		));
		expect(pick(candidates, 'price').value).toBe(129.9);
	});

	it('legge window.__INITIAL_STATE__', () => {
		const candidates = appState.extract(doc(
			`<script>window.__INITIAL_STATE__ = {"item":{"productId":7,"price":49,"currencyCode":"GBP"}};</script>`
		));
		expect(pick(candidates, 'price').value).toBe(49);
		expect(pick(candidates, 'currency').value).toBe('GBP');
	});

	it('legge il dataLayer di GA4', () => {
		const candidates = appState.extract(doc(
			`<script>dataLayer = [{"event":"view_item","ecommerce":{"currency":"EUR","items":[{"item_id":"SKU1","price":259.9,"currency":"EUR"}]}}];</script>`
		));
		expect(pick(candidates, 'price').value).toBe(259.9);
	});

	it('legge window.prestashop', () => {
		const candidates = appState.extract(doc(
			`<script>window.prestashop = {"product":{"id_product":12,"price_amount":0,"price":"89,90","currency":"EUR"}};</script>`
		));
		expect(pick(candidates, 'price').value).toBe(89.9);
	});
});

describe('appState - robustezza', () => {
	it('ignora uno script con JSON rotto senza perdere gli altri', () => {
		const candidates = appState.extract(doc(`
			<script>window.__NUXT__ = {rotto;</script>
			<script id="__NEXT_DATA__" type="application/json">{"p":{"sku":"A","price":10,"currency":"EUR"}}</script>`));
		expect(pick(candidates, 'price').value).toBe(10);
	});

	it('regge riferimenti ciclici senza andare in loop', () => {
		const cyclic = { sku: 'A', price: 10, currency: 'EUR' };
		cyclic.self = cyclic;
		// Non serializzabile: si verifica direttamente findPriceObjects.
		const found = appState.findPriceObjects(cyclic, 'test');
		expect(found).toHaveLength(1);
		expect(found[0].price).toBe(10);
	});

	it('restituisce un elenco vuoto senza stato applicativo', () => {
		expect(appState.extract(doc('<p>niente</p>'))).toEqual([]);
	});

	it('non produce candidati per un prezzo non parsabile', () => {
		const candidates = appState.extract(doc(
			`<script id="__NEXT_DATA__" type="application/json">{"p":{"sku":"A","price":"su richiesta","currency":"EUR"}}</script>`
		));
		expect(pick(candidates, 'price')).toBeUndefined();
	});
});
