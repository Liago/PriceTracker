import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import cssPathModule from '../../scrape/extract/cssPath.js';

const { createDocument } = documentModule;
const { cssPath, isGeneratedClass, isUsableId } = cssPathModule;

/** Genera il selettore per il primo elemento che corrisponde a `target`. */
function pathFor(html, target) {
	const doc = createDocument(`<html><body>${html}</body></html>`);
	const element = doc.$(target).first()[0];
	return { selector: cssPath(doc.$, element), doc, element };
}

/** Il selettore generato riseleziona esattamente lo stesso elemento? */
function roundTrips(html, target) {
	const { selector, doc, element } = pathFor(html, target);
	if (!selector) return false;
	const matched = doc.$(selector);
	return matched.length >= 1 && matched[0] === element;
}

describe('isGeneratedClass', () => {
	it('riconosce le classi generate a build time', () => {
		for (const className of ['css-1a2b3c', 'jsx-1234567', 'sc-bdVaJa', 'styles_price__a1b2c', 'a1b2c3d4']) {
			expect(isGeneratedClass(className)).toBe(true);
		}
	});

	it('non scarta le classi scritte a mano', () => {
		for (const className of ['price', 'product-price', 'prezzo-attuale', 'price--sale']) {
			expect(isGeneratedClass(className)).toBe(false);
		}
	});

	it('non scarta le classi BEM, che sono stabili', () => {
		// "price__value" e "styles_price__a1b2c" hanno la stessa forma: il
		// discrimine e' che l'hash mescola lettere e cifre, la parola no.
		for (const className of ['price__value', 'card__title', 'product_name']) {
			expect(isGeneratedClass(className), className).toBe(false);
		}
		for (const className of ['styles_price__a1b2c', 'Button_primary__2Fzcx']) {
			expect(isGeneratedClass(className), className).toBe(true);
		}
	});
});

describe('isUsableId', () => {
	it('accetta id leggibili', () => {
		expect(isUsableId('product-price')).toBe(true);
	});

	it('rifiuta id generati o non validi come selettore', () => {
		expect(isUsableId('a1b2c3d4e5')).toBe(false);   // hash
		expect(isUsableId('123')).toBe(false);          // inizia con cifra
		expect(isUsableId('due parole')).toBe(false);
		expect(isUsableId('')).toBe(false);
	});
});

describe('cssPath', () => {
	it('usa l\'id quando e\' utilizzabile', () => {
		const { selector } = pathFor('<div id="product-price">729,00 €</div>', '#product-price');
		expect(selector).toBe('#product-price');
	});

	it('preferisce gli attributi data-test alle classi', () => {
		const { selector } = pathFor('<div class="a b" data-test="price">729,00 €</div>', '[data-test=price]');
		expect(selector).toContain('data-test="price"');
	});

	it('usa le classi scritte a mano', () => {
		const { selector } = pathFor('<div class="product-price">729,00 €</div>', '.product-price');
		expect(selector).toContain('.product-price');
	});

	it('ignora le classi generate e risale finche\' serve', () => {
		const html = '<div class="wrap"><span class="css-1a2b3c">729,00 €</span></div>';
		const { selector } = pathFor(html, 'span');
		expect(selector).not.toContain('css-1a2b3c');
		expect(roundTrips(html, 'span')).toBe(true);
	});

	it('distingue fratelli identici con nth-of-type', () => {
		const html = '<ul><li>uno</li><li>due</li><li>tre</li></ul>';
		const { selector, doc, element } = pathFor(html, 'li:nth-of-type(2)');
		expect(selector).toContain('nth-of-type');
		expect(doc.$(selector)[0]).toBe(element);
	});

	it('risale finche\' il selettore non e\' univoco', () => {
		const html = `
			<div class="col-a"><span class="price">19,90 €</span></div>
			<div class="col-b"><span class="price">729,00 €</span></div>`;
		const doc = createDocument(`<html><body>${html}</body></html>`);
		const target = doc.$('.col-b .price')[0];
		const selector = cssPath(doc.$, target);

		expect(doc.$(selector)).toHaveLength(1);
		expect(doc.$(selector)[0]).toBe(target);
	});

	it('riseleziona sempre lo stesso elemento su strutture varie', () => {
		const cases = [
			['<div class="a"><div class="b"><span class="price">1,00 €</span></div></div>', '.price'],
			['<main><section><article><p class="prezzo">2,00 €</p></article></section></main>', '.prezzo'],
			['<div data-qa="product-price">3,00 €</div>', '[data-qa]'],
			['<div><span itemprop="price" content="4.00"></span></div>', '[itemprop=price]'],
			['<div><b>5,00 €</b></div>', 'b'],
		];
		for (const [html, target] of cases) {
			expect(roundTrips(html, target), `fallito su ${target}`).toBe(true);
		}
	});

	it('restituisce null su input non validi', () => {
		const doc = createDocument('<html><body></body></html>');
		expect(cssPath(doc.$, null)).toBeNull();
		expect(cssPath(doc.$, {})).toBeNull();
	});
});
