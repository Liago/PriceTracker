import { describe, it, expect } from 'vitest';
import normalizeResult from '../../scrape/normalizeResult.js';

const { normalizeScrapeResult } = normalizeResult;

describe('normalizeScrapeResult', () => {
	it('arricchisce un risultato tipico senza perdere i campi originali', () => {
		const raw = {
			title: 'Apple iPhone 15',
			image: 'https://x.it/i.jpg',
			price: '729,00 €',
			currency: 'EUR',
			store: 'mediaworld',
			available: true,
			details: { features: ['a', 'b'] },
		};

		const result = normalizeScrapeResult(raw, 'https://www.mediaworld.it/p');

		expect(result.title).toBe('Apple iPhone 15');
		expect(result.details.features).toEqual(['a', 'b']);
		expect(result.price).toBe('729,00 €');   // campo originale conservato
		expect(result.priceValue).toBe(729);      // campo nuovo
		expect(result.currency).toBe('EUR');
		expect(result.availability).toBe('in_stock');
		expect(result.available).toBe(true);
	});

	it('restituisce priceValue null quando il prezzo non e\' leggibile', () => {
		const result = normalizeScrapeResult({ price: 'Non disponibile' });
		expect(result.priceValue).toBeNull();
		expect(result.normalization.priceReason).toBe('not_a_price');
	});

	it('legge la valuta dal simbolo quando lo scraper non la dichiara', () => {
		const result = normalizeScrapeResult({ price: '£1,299.99' }, 'https://shop.co.uk/p');
		expect(result.priceValue).toBe(1299.99);
		expect(result.currency).toBe('GBP');
	});

	it('scioglie il dollaro con il dominio e lo segnala quando non ci riesce', () => {
		const canadese = normalizeScrapeResult({ price: '$99.00' }, 'https://shop.example.ca/p');
		expect(canadese.currency).toBe('CAD');
		expect(canadese.normalization.currencyAmbiguous).toBe(false);

		const ambiguo = normalizeScrapeResult({ price: '$99.00' }, 'https://shop.example.com/p');
		expect(ambiguo.currency).toBe('USD');
		expect(ambiguo.normalization.currencyAmbiguous).toBe(true);
	});

	it('da\' la precedenza alla valuta dichiarata dallo scraper', () => {
		const result = normalizeScrapeResult({ price: '99,00', currency: 'CHF' }, 'https://x.it/p');
		expect(result.currency).toBe('CHF');
	});

	it('converte il booleano available nell\'enum', () => {
		expect(normalizeScrapeResult({ available: false }).availability).toBe('out_of_stock');
		expect(normalizeScrapeResult({ available: true }).availability).toBe('in_stock');
	});

	it('non inventa un esaurito quando la disponibilita\' e\' ignota', () => {
		const result = normalizeScrapeResult({ price: '729,00' });
		expect(result.availability).toBe('unknown');
		expect(result.available).toBeNull();
	});

	it('preferisce availability esplicita al booleano legacy', () => {
		const result = normalizeScrapeResult({ availability: 'https://schema.org/PreOrder', available: false });
		expect(result.availability).toBe('preorder');
		expect(result.available).toBe(true);
	});

	it('segnala un intervallo di prezzo', () => {
		const result = normalizeScrapeResult({ price: 'da 199,00 € a 249,00 €' });
		expect(result.priceValue).toBe(199);
		expect(result.normalization.hadRange).toBe(true);
	});

	it('regge un input vuoto o non oggetto', () => {
		for (const input of [null, undefined, 'stringa']) {
			const result = normalizeScrapeResult(input);
			expect(result.priceValue).toBeNull();
			expect(result.availability).toBe('unknown');
		}
	});
});
