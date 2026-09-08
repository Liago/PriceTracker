import { describe, it, expect } from 'vitest';
import availabilityModule from '../../scrape/normalize/availability.js';

const { normalizeAvailability, toLegacyBoolean, AVAILABILITY } = availabilityModule;

describe('normalizeAvailability - schema.org', () => {
	const cases = [
		['https://schema.org/InStock', AVAILABILITY.IN_STOCK],
		['http://schema.org/InStock', AVAILABILITY.IN_STOCK],
		['InStock', AVAILABILITY.IN_STOCK],
		['https://schema.org/OutOfStock', AVAILABILITY.OUT_OF_STOCK],
		['https://schema.org/SoldOut', AVAILABILITY.OUT_OF_STOCK],
		['https://schema.org/PreOrder', AVAILABILITY.PREORDER],
		['https://schema.org/BackOrder', AVAILABILITY.BACKORDER],
		['https://schema.org/Discontinued', AVAILABILITY.DISCONTINUED],
		['https://schema.org/LimitedAvailability', AVAILABILITY.IN_STOCK],
	];
	for (const [input, expected] of cases) {
		it(`${input} -> ${expected}`, () => {
			expect(normalizeAvailability(input)).toBe(expected);
		});
	}
});

describe('normalizeAvailability - testo della pagina', () => {
	const cases = [
		['Disponibile', AVAILABILITY.IN_STOCK],
		['Disponibilità immediata', AVAILABILITY.IN_STOCK],
		['In stock', AVAILABILITY.IN_STOCK],
		['Aggiungi al carrello', AVAILABILITY.IN_STOCK],
		['Non disponibile', AVAILABILITY.OUT_OF_STOCK],
		['Esaurito', AVAILABILITY.OUT_OF_STOCK],
		['Out of stock', AVAILABILITY.OUT_OF_STOCK],
		['Currently unavailable', AVAILABILITY.OUT_OF_STOCK],
		['Preordina ora', AVAILABILITY.PREORDER],
		['Su ordinazione', AVAILABILITY.BACKORDER],
		['Non più disponibile', AVAILABILITY.DISCONTINUED],
	];
	for (const [input, expected] of cases) {
		it(`${JSON.stringify(input)} -> ${expected}`, () => {
			expect(normalizeAvailability(input)).toBe(expected);
		});
	}

	it('non confonde "non disponibile" con "disponibile"', () => {
		// L'ordine dei pattern conta: la frase negativa contiene quella positiva.
		expect(normalizeAvailability('Non disponibile')).toBe(AVAILABILITY.OUT_OF_STOCK);
		expect(normalizeAvailability('Prodotto non disponibile al momento')).toBe(AVAILABILITY.OUT_OF_STOCK);
	});
});

describe('normalizeAvailability - ignoto', () => {
	it('restituisce unknown invece di indovinare', () => {
		expect(normalizeAvailability(null)).toBe(AVAILABILITY.UNKNOWN);
		expect(normalizeAvailability(undefined)).toBe(AVAILABILITY.UNKNOWN);
		expect(normalizeAvailability('')).toBe(AVAILABILITY.UNKNOWN);
		expect(normalizeAvailability('   ')).toBe(AVAILABILITY.UNKNOWN);
		expect(normalizeAvailability('spedizione in 24h')).toBe(AVAILABILITY.UNKNOWN);
	});
});

describe('normalizeAvailability - booleano legacy', () => {
	it('converte il campo available dei vecchi scraper', () => {
		expect(normalizeAvailability(true)).toBe(AVAILABILITY.IN_STOCK);
		expect(normalizeAvailability(false)).toBe(AVAILABILITY.OUT_OF_STOCK);
	});

	it('accetta un valore gia\' normalizzato', () => {
		expect(normalizeAvailability('in_stock')).toBe(AVAILABILITY.IN_STOCK);
		expect(normalizeAvailability('out_of_stock')).toBe(AVAILABILITY.OUT_OF_STOCK);
	});
});

describe('toLegacyBoolean', () => {
	it('mappa l\'enum sul booleano che il client si aspetta', () => {
		expect(toLegacyBoolean(AVAILABILITY.IN_STOCK)).toBe(true);
		expect(toLegacyBoolean(AVAILABILITY.PREORDER)).toBe(true);
		expect(toLegacyBoolean(AVAILABILITY.OUT_OF_STOCK)).toBe(false);
		expect(toLegacyBoolean(AVAILABILITY.DISCONTINUED)).toBe(false);
	});

	it('restituisce null per unknown, senza inventare un esaurito', () => {
		expect(toLegacyBoolean(AVAILABILITY.UNKNOWN)).toBeNull();
	});
});
