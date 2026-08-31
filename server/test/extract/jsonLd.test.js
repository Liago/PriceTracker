import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import jsonLd from '../../scrape/extract/jsonLd.js';

const { createDocument } = documentModule;

/** Costruisce una pagina con i blocchi JSON-LD dati. */
function page(...blocks) {
	const scripts = blocks
		.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`)
		.join('\n');
	return createDocument(`<!doctype html><html><head>${scripts}</head><body></body></html>`, {
		url: 'https://shop.example.it/p',
	});
}

/** Primo candidato per un campo. */
const pick = (candidates, field) => candidates.find((c) => c.field === field);
const all = (candidates, field) => candidates.filter((c) => c.field === field);

const PRODUCT = {
	'@context': 'https://schema.org',
	'@type': 'Product',
	name: 'Apple iPhone 15',
	description: 'Smartphone con chip A16',
	image: 'https://shop.example.it/i.jpg',
	sku: 'IPH15-128',
	gtin13: '0194253000000',
	brand: { '@type': 'Brand', name: 'Apple' },
	offers: {
		'@type': 'Offer',
		price: '729.00',
		priceCurrency: 'EUR',
		availability: 'https://schema.org/InStock',
	},
};

describe('jsonLd - struttura di base', () => {
	it('estrae prezzo, valuta e disponibilita\' da un Product semplice', () => {
		const candidates = jsonLd.extract(page(PRODUCT));

		expect(pick(candidates, 'price').value).toBe(729);
		expect(pick(candidates, 'currency').value).toBe('EUR');
		expect(pick(candidates, 'availability').value).toBe('in_stock');
	});

	it('estrae i campi descrittivi e gli identificatori', () => {
		const candidates = jsonLd.extract(page(PRODUCT));

		expect(pick(candidates, 'title').value).toBe('Apple iPhone 15');
		expect(pick(candidates, 'image').value).toBe('https://shop.example.it/i.jpg');
		expect(pick(candidates, 'brand').value).toBe('Apple');
		expect(pick(candidates, 'sku').value).toBe('IPH15-128');
		expect(pick(candidates, 'gtin').value).toBe('0194253000000');
	});

	it('assegna provenienza e percorso a ogni candidato', () => {
		const price = pick(jsonLd.extract(page(PRODUCT)), 'price');

		expect(price.source).toBe('jsonld');
		expect(price.path).toContain('offers');
		expect(price.weight).toBe(0.9);
		expect(price.raw).toBe('729.00');
	});
});

describe('jsonLd - forme che gli scraper attuali non gestiscono', () => {
	it('radice che e\' un array', () => {
		const candidates = jsonLd.extract(page([{ '@type': 'WebSite', name: 'Shop' }, PRODUCT]));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('@graph (WordPress, Yoast)', () => {
		const candidates = jsonLd.extract(page({
			'@context': 'https://schema.org',
			'@graph': [{ '@type': 'WebPage', name: 'Pagina' }, PRODUCT],
		}));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('Product annidato dentro mainEntity', () => {
		const candidates = jsonLd.extract(page({
			'@type': 'ItemPage',
			mainEntity: PRODUCT,
		}));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('piu\' blocchi script, uno solo dei quali e\' il prodotto', () => {
		const candidates = jsonLd.extract(page(
			{ '@type': 'BreadcrumbList', itemListElement: [] },
			{ '@type': 'Organization', name: 'Shop' },
			PRODUCT,
		));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('offers come array', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: [
				{ '@type': 'Offer', price: '729.00', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
				{ '@type': 'Offer', price: '799.00', priceCurrency: 'EUR', seller: { name: 'Altro venditore' } },
			],
		}));

		const prices = all(candidates, 'price').map((c) => c.value);
		expect(prices).toEqual([729, 799]);
		expect(pick(candidates, 'seller').value).toBe('Altro venditore');
	});

	it('AggregateOffer: prende lowPrice e segnala l\'intervallo', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: { '@type': 'AggregateOffer', lowPrice: '699.00', highPrice: '899.00', priceCurrency: 'EUR' },
		}));

		const price = pick(candidates, 'price');
		expect(price.value).toBe(699);
		expect(price.meta.isRange).toBe(true);
	});

	it('priceSpecification quando price manca', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: {
				'@type': 'Offer',
				priceSpecification: { '@type': 'PriceSpecification', price: '729.00', priceCurrency: 'EUR' },
			},
		}));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('ESCLUDE il prezzo unitario (al chilo, al litro)', () => {
		// UnitPriceSpecification con referenceQuantity diversa da 1 e' il
		// prezzo al chilo: prenderlo per il prezzo del prodotto e' uno dei
		// modi classici di scrivere a database un numero sbagliato.
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: {
				'@type': 'Offer',
				priceSpecification: [
					{ '@type': 'UnitPriceSpecification', price: '4.99', referenceQuantity: { value: 100, unitCode: 'GRM' } },
					{ '@type': 'PriceSpecification', price: '12.45', priceCurrency: 'EUR' },
				],
			},
		}));

		expect(pick(candidates, 'price').value).toBe(12.45);
	});

	it('accetta un prezzo unitario con referenceQuantity uguale a 1', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: {
				'@type': 'Offer',
				priceSpecification: { '@type': 'UnitPriceSpecification', price: '12.45', referenceQuantity: { value: 1 } },
			},
		}));
		expect(pick(candidates, 'price').value).toBe(12.45);
	});

	it('@type come array', () => {
		const candidates = jsonLd.extract(page({ ...PRODUCT, '@type': ['Product', 'Thing'] }));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('estrae condizione e venditore quando presenti', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: {
				'@type': 'Offer', price: '379.00', priceCurrency: 'EUR',
				itemCondition: 'https://schema.org/RefurbishedCondition',
				seller: { '@type': 'Organization', name: 'Back Market' },
			},
		}));

		expect(pick(candidates, 'condition').value).toBe('RefurbishedCondition');
		expect(pick(candidates, 'seller').value).toBe('Back Market');
	});
});

describe('jsonLd - tolleranza agli errori', () => {
	it('ignora un blocco malformato senza perdere gli altri', () => {
		const candidates = jsonLd.extract(page('{ questo non e\' JSON', PRODUCT));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('recupera il JSON con virgola finale', () => {
		const candidates = jsonLd.extract(page(
			'{"@type":"Product","name":"X","offers":{"@type":"Offer","price":"99.00","priceCurrency":"EUR",},}'
		));
		expect(pick(candidates, 'price').value).toBe(99);
	});

	it('gestisce CDATA e commenti HTML attorno al JSON', () => {
		const candidates = jsonLd.extract(page(`<!--//--><![CDATA[//><!--${JSON.stringify(PRODUCT)}//--><!]]>`));
		expect(pick(candidates, 'price').value).toBe(729);
	});

	it('restituisce un elenco vuoto senza JSON-LD', () => {
		expect(jsonLd.extract(createDocument('<html><body>ciao</body></html>'))).toEqual([]);
	});

	it('restituisce un elenco vuoto se non c\'e\' nessun Product', () => {
		expect(jsonLd.extract(page({ '@type': 'Article', headline: 'Notizia' }))).toEqual([]);
	});

	it('non produce candidati per un prezzo non parsabile', () => {
		const candidates = jsonLd.extract(page({
			...PRODUCT,
			offers: { '@type': 'Offer', price: 'su richiesta', priceCurrency: 'EUR' },
		}));
		expect(pick(candidates, 'price')).toBeUndefined();
		expect(pick(candidates, 'currency').value).toBe('EUR');
	});
});
