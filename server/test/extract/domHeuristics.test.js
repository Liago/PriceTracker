import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import dom from '../../scrape/extract/domHeuristics.js';

const { createDocument } = documentModule;
const pick = (candidates, field) => candidates.find((c) => c.field === field);
const doc = (body) => createDocument(`<html><body>${body}</body></html>`, { url: 'https://shop.example.it/p' });
const priceOf = (body, context) => pick(dom.extract(doc(body), context), 'price');

describe('looksLikePrice', () => {
	it('accetta importi con marcatore di valuta', () => {
		for (const text of ['729,00 €', '€ 729,00', '$99', '1.299,99 EUR', '£45.00']) {
			expect(dom.looksLikePrice(text)).toBe(true);
		}
	});

	it('accetta un numero con due decimali anche senza valuta', () => {
		expect(dom.looksLikePrice('729,00')).toBe(true);
		expect(dom.looksLikePrice('1.299,99')).toBe(true);
	});

	it('rifiuta numeri nudi senza decimali ne\' valuta', () => {
		// Altrimenti qualunque cifra della pagina diventa un candidato prezzo.
		expect(dom.looksLikePrice('128')).toBe(false);
		expect(dom.looksLikePrice('2024')).toBe(false);
	});

	it('rifiuta percentuali, testo lungo e stringhe vuote', () => {
		expect(dom.looksLikePrice('-20%')).toBe(false);
		expect(dom.looksLikePrice('Un paragrafo molto lungo che contiene 45,00 € da qualche parte al suo interno')).toBe(false);
		expect(dom.looksLikePrice('')).toBe(false);
		expect(dom.looksLikePrice(null)).toBe(false);
	});
});

describe('domHeuristics - estrazione di base', () => {
	it('trova il prezzo in un contenitore con classe price', () => {
		const price = priceOf('<div class="product-price">729,00 €</div>');
		expect(price.value).toBe(729);
		expect(price.meta.signals).toContain('classe-prezzo');
	});

	it('prende il contenitore piu\' interno, non l\'involucro', () => {
		const price = priceOf('<div class="wrapper"><div class="price"><span>729,00 €</span></div></div>');
		expect(price.value).toBe(729);
	});

	it('legge la valuta dal testo del prezzo vincente', () => {
		const candidates = dom.extract(doc('<div class="price">£1,299.00</div>'));
		expect(pick(candidates, 'currency').value).toBe('GBP');
	});

	it('non produce nulla su una pagina senza prezzi', () => {
		expect(dom.extract(doc('<p>Nessun prezzo qui</p>'))).toEqual([]);
	});
});

describe('domHeuristics - esclusioni: i falsi positivi tipici', () => {
	it('scarta il prezzo barrato dentro <del>', () => {
		const price = priceOf('<div class="price"><del>899,00 €</del> <span>729,00 €</span></div>');
		expect(price.value).toBe(729);
	});

	it('scarta il prezzo barrato dentro <s>', () => {
		expect(priceOf('<s>899,00 €</s><div class="price">729,00 €</div>').value).toBe(729);
	});

	it('scarta il barrato riconosciuto dallo stile inline', () => {
		const price = priceOf('<span style="text-decoration: line-through">899,00 €</span><div class="price">729,00 €</div>');
		expect(price.value).toBe(729);
	});

	it('scarta il barrato riconosciuto dalla classe', () => {
		expect(priceOf('<span class="old-price">899,00 €</span><div class="price">729,00 €</div>').value).toBe(729);
	});

	it('scarta il costo di spedizione', () => {
		const price = priceOf(`
			<div class="price">729,00 €</div>
			<div class="shipping-cost">4,99 €</div>`);
		expect(price.value).toBe(729);
	});

	it('scarta la rata mensile', () => {
		const price = priceOf(`
			<div class="price">729,00 €</div>
			<div class="installment">o 24,30 € al mese</div>`);
		expect(price.value).toBe(729);
	});

	it('scarta un prezzo preceduto da "anziche\'"', () => {
		const price = priceOf(`
			<div class="price">729,00 €</div>
			<div class="promo">anziché 899,00 €</div>`);
		expect(price.value).toBe(729);
	});

	it('scarta il prezzo al chilo', () => {
		const price = priceOf(`
			<div class="price">12,45 €</div>
			<div class="unit">4,99 € /kg</div>`);
		expect(price.value).toBe(12.45);
	});

	it('scarta gli elementi nascosti', () => {
		const price = priceOf(`
			<div style="display:none">1,00 €</div>
			<div hidden>2,00 €</div>
			<div aria-hidden="true">3,00 €</div>
			<div class="price">729,00 €</div>`);
		expect(price.value).toBe(729);
	});

	it('scarta i prezzi dei prodotti correlati', () => {
		const price = priceOf(`
			<main><div class="price">729,00 €</div></main>
			<section class="related-products">
				<div class="price">19,90 €</div>
				<div class="price">29,90 €</div>
			</section>`);
		expect(price.value).toBe(729);
	});

	it('scarta i prezzi in nav e footer', () => {
		const price = priceOf(`
			<nav><span class="price">9,99 €</span></nav>
			<div class="price">729,00 €</div>
			<footer><span class="price">1,00 €</span></footer>`);
		expect(price.value).toBe(729);
	});

	it('restituisce vuoto se tutti i candidati vengono scartati', () => {
		expect(dom.extract(doc('<del>899,00 €</del>'))).toEqual([]);
	});
});

describe('domHeuristics - punteggio', () => {
	it('premia la vicinanza al bottone di acquisto', () => {
		const price = priceOf(`
			<div class="col"><span>29,90 €</span></div>
			<div class="buybox">
				<span>729,00 €</span>
				<button data-test="add-to-cart">Aggiungi al carrello</button>
			</div>`);
		expect(price.value).toBe(729);
		expect(price.meta.signals).toContain('vicino-al-carrello');
	});

	it('premia la coerenza con l\'ultimo prezzo noto', () => {
		const body = '<div class="a">19,90 €</div><div class="b">729,00 €</div>';
		expect(priceOf(body, { lastKnownPrice: 750 }).value).toBe(729);
		expect(priceOf(body, { lastKnownPrice: 20 }).value).toBe(19.9);
	});

	it('riconosce il pattern sconto: barrato piu\' alto accanto', () => {
		const price = priceOf('<div class="box"><del>899,00 €</del><span>729,00 €</span></div>');
		expect(price.meta.signals).toContain('sconto-su-barrato');
		expect(price.meta.discardedStruck).toBe(1);
	});

	it('segnala l\'ambiguita\' quando due candidati sono equivalenti', () => {
		// Due prezzi indistinguibili: la scelta non e' netta e il peso deve
		// scendere, cosi' la validazione potra' mandare in quarantena.
		const ambiguo = priceOf('<div><span>729,00 €</span></div><div><span>649,00 €</span></div>');
		expect(ambiguo.meta.ambiguous).toBe(true);

		const netto = priceOf('<div class="product-price">729,00 €</div>');
		expect(netto.meta.ambiguous).toBe(false);
		expect(netto.weight).toBeGreaterThan(ambiguo.weight);
	});

	it('non supera mai il peso di una sorgente strutturata', () => {
		const price = priceOf(`
			<div class="product-price" itemprop="price">729,00 €</div>
			<button class="add-to-cart">Aggiungi al carrello</button>`);
		expect(price.weight).toBeLessThanOrEqual(0.85);
		expect(price.source).toBe('dom');
	});

	it('riporta quanti candidati ha considerato', () => {
		const price = priceOf('<div class="price">729,00 €</div><div class="p2">649,00 €</div>');
		expect(price.meta.consideredCount).toBe(2);
	});
});
