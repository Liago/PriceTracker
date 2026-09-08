import { describe, it, expect } from 'vitest';
import currency from '../../scrape/normalize/currency.js';

const { normalizeCurrency, normalizeCurrencyDetailed, tldOf } = currency;

describe('normalizeCurrency - codici ISO', () => {
	it('accetta un codice gia\' valido', () => {
		expect(normalizeCurrency('EUR')).toBe('EUR');
		expect(normalizeCurrency('GBP')).toBe('GBP');
	});

	it('normalizza il caso', () => {
		expect(normalizeCurrency('eur')).toBe('EUR');
		expect(normalizeCurrency('Usd')).toBe('USD');
	});

	it('estrae il codice da una stringa piu\' lunga', () => {
		expect(normalizeCurrency('729.00 EUR')).toBe('EUR');
		expect(normalizeCurrency('CHF 1 299,99')).toBe('CHF');
	});

	it('ignora una sigla di tre lettere che non e\' una valuta', () => {
		expect(normalizeCurrency('IVA')).toBe('EUR'); // ricade sul fallback
	});
});

describe('normalizeCurrency - simboli univoci', () => {
	const cases = [
		['€', 'EUR'], ['€ 729,00', 'EUR'], ['729,00 €', 'EUR'],
		['£', 'GBP'], ['£1,299.99', 'GBP'],
		['¥', 'JPY'], ['₹', 'INR'], ['zł', 'PLN'], ['Kč', 'CZK'],
	];
	for (const [input, expected] of cases) {
		it(`${JSON.stringify(input)} -> ${expected}`, () => {
			expect(normalizeCurrency(input)).toBe(expected);
		});
	}
});

describe('normalizeCurrency - simboli ambigui', () => {
	it('scioglie il dollaro con il TLD del sito', () => {
		expect(normalizeCurrency('$99', { url: 'https://shop.example.ca/p' })).toBe('CAD');
		expect(normalizeCurrency('$99', { url: 'https://shop.example.com.au/p' })).toBe('AUD');
		expect(normalizeCurrency('$99', { url: 'https://shop.example.com/p' })).toBe('USD');
	});

	it('scioglie la corona con il TLD del sito', () => {
		expect(normalizeCurrency('199 kr', { url: 'https://butikk.example.no/p' })).toBe('NOK');
		expect(normalizeCurrency('199 kr', { url: 'https://butik.example.dk/p' })).toBe('DKK');
	});

	it('segnala l\'ambiguita\' quando il TLD non aiuta', () => {
		const result = normalizeCurrencyDetailed('$99', { url: 'https://shop.example.com/p' });
		expect(result.code).toBe('USD');
		expect(result.ambiguous).toBe(true);
	});

	it('non segnala ambiguita\' quando il TLD ha deciso', () => {
		const result = normalizeCurrencyDetailed('$99', { url: 'https://shop.example.ca/p' });
		expect(result.ambiguous).toBe(false);
		expect(result.source).toBe('symbol_tld');
	});

	it('accetta un hostname nudo oltre a un URL completo', () => {
		expect(normalizeCurrency('$99', { url: 'shop.example.ca' })).toBe('CAD');
	});
});

describe('normalizeCurrency - fallback', () => {
	it('usa EUR quando non c\'e\' nulla da leggere', () => {
		expect(normalizeCurrency(null)).toBe('EUR');
		expect(normalizeCurrency('')).toBe('EUR');
		expect(normalizeCurrency('   ')).toBe('EUR');
		expect(normalizeCurrency('prezzo su richiesta')).toBe('EUR');
	});

	it('permette di disattivare il fallback', () => {
		expect(normalizeCurrency(null, { fallback: null })).toBeNull();
		expect(normalizeCurrencyDetailed(null, { fallback: null }).source).toBe('none');
	});

	it('permette un fallback diverso', () => {
		expect(normalizeCurrency(null, { fallback: 'GBP' })).toBe('GBP');
	});
});

describe('tldOf', () => {
	it('estrae il TLD da URL e hostname', () => {
		expect(tldOf('https://www.amazon.it/dp/X')).toBe('it');
		expect(tldOf('https://shop.example.co.uk/p')).toBe('uk');
		expect(tldOf('www.mediaworld.it')).toBe('it');
	});

	it('restituisce null su input inutilizzabili', () => {
		expect(tldOf(null)).toBeNull();
		expect(tldOf('localhost')).toBeNull();
		expect(tldOf('')).toBeNull();
	});
});
