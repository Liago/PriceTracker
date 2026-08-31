import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import microdata from '../../scrape/extract/microdata.js';

const { createDocument } = documentModule;
const pick = (candidates, field) => candidates.find((c) => c.field === field);
const doc = (body) => createDocument(`<html><body>${body}</body></html>`, { url: 'https://shop.example.it/p' });

describe('microdata', () => {
	it('estrae prezzo e valuta da un blocco Product', () => {
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<span itemprop="name">Prodotto</span>
				<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
					<meta itemprop="price" content="729.00">
					<meta itemprop="priceCurrency" content="EUR">
					<link itemprop="availability" href="https://schema.org/InStock">
				</div>
			</div>`));

		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'currency').value).toBe('EUR');
		expect(pick(candidates, 'availability').value).toBe('in_stock');
		expect(pick(candidates, 'title').value).toBe('Prodotto');
	});

	it('preferisce l\'attributo content al testo visibile', () => {
		// Su <meta itemprop="price" content="729.00"> il valore buono e'
		// l'attributo, non l'eventuale testo formattato accanto.
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<span itemprop="price" content="729.00">729,00 € IVA inclusa</span>
			</div>`));

		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'price').raw).toBe('729.00');
	});

	it('ricade sul testo quando non c\'e\' l\'attributo', () => {
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<span itemprop="price">1.299,90 €</span>
			</div>`));

		expect(pick(candidates, 'price').value).toBe(1299.9);
	});

	it('legge href da link e src da img', () => {
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<img itemprop="image" src="https://shop.example.it/i.jpg">
				<link itemprop="availability" href="https://schema.org/OutOfStock">
			</div>`));

		expect(pick(candidates, 'image').value).toBe('https://shop.example.it/i.jpg');
		expect(pick(candidates, 'availability').value).toBe('out_of_stock');
	});

	it('si limita all\'ambito Product quando la pagina lo dichiara', () => {
		// Il prezzo di un prodotto correlato, fuori dall'ambito, non deve vincere.
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<meta itemprop="price" content="729.00">
			</div>
			<aside itemscope itemtype="https://schema.org/Product">
				<meta itemprop="price" content="19.90">
			</aside>`));

		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('cerca ovunque se la pagina non dichiara un itemtype Product', () => {
		const candidates = microdata.extract(doc('<span itemprop="price" content="49.90"></span>'));
		expect(pick(candidates, 'price').value).toBe(49.9);
	});

	it('estrae gli identificatori', () => {
		const candidates = microdata.extract(doc(`
			<div itemscope itemtype="https://schema.org/Product">
				<meta itemprop="sku" content="ABC-1">
				<meta itemprop="gtin13" content="0194253000000">
				<meta itemprop="brand" content="Apple">
			</div>`));

		expect(pick(candidates, 'sku').value).toBe('ABC-1');
		expect(pick(candidates, 'gtin').value).toBe('0194253000000');
		expect(pick(candidates, 'brand').value).toBe('Apple');
	});

	it('restituisce un elenco vuoto senza microdata', () => {
		expect(microdata.extract(doc('<p>niente</p>'))).toEqual([]);
	});
});
