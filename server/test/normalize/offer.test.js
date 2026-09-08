import { describe, it, expect } from 'vitest';
import offerModule from '../../scrape/normalize/offer.js';

const { offerKey, describeOffer, canonicalizeUrl, variantFromUrl } = offerModule;

describe('canonicalizeUrl', () => {
	it('rimuove i parametri di tracciamento', () => {
		expect(canonicalizeUrl('https://shop.it/p?utm_source=x&utm_medium=y&gclid=z'))
			.toBe('https://shop.it/p');
	});

	it('CONSERVA i parametri di variante', () => {
		// Toglierli significherebbe seguire un prodotto diverso da quello che
		// l'utente ha aggiunto.
		const url = canonicalizeUrl('https://shop.it/p?variant=456&utm_source=x');
		expect(url).toContain('variant=456');
		expect(url).not.toContain('utm_source');
	});

	it('rimuove il frammento e la barra finale', () => {
		expect(canonicalizeUrl('https://shop.it/p/#recensioni')).toBe('https://shop.it/p');
		expect(canonicalizeUrl('https://shop.it/p/')).toBe('https://shop.it/p');
	});

	it('ordina i parametri, cosi\' due URL equivalenti danno la stessa forma', () => {
		expect(canonicalizeUrl('https://shop.it/p?b=2&a=1'))
			.toBe(canonicalizeUrl('https://shop.it/p?a=1&b=2'));
	});

	it('rimuove i parametri affiliati di Amazon', () => {
		const url = canonicalizeUrl('https://www.amazon.it/dp/B0TEST?tag=aff-21&psc=1&th=1');
		expect(url).toBe('https://www.amazon.it/dp/B0TEST');
	});

	it('restituisce null su URL non validi', () => {
		expect(canonicalizeUrl('non-un-url')).toBeNull();
		expect(canonicalizeUrl(null)).toBeNull();
	});
});

describe('variantFromUrl', () => {
	it('estrae i parametri che descrivono una variante', () => {
		expect(variantFromUrl('https://shop.it/p?variant=456&color=nero&utm_source=x'))
			.toEqual({ variant: '456', color: 'nero' });
	});

	it('riconosce le varianti Salesforce (dwvar_)', () => {
		expect(variantFromUrl('https://shop.it/p?dwvar_123_color=blu'))
			.toEqual({ dwvar_123_color: 'blu' });
	});

	it('restituisce un oggetto vuoto se non ce ne sono', () => {
		expect(variantFromUrl('https://shop.it/p')).toEqual({});
		expect(variantFromUrl('non-un-url')).toEqual({});
	});
});

describe('offerKey', () => {
	it('vale "default" quando non c\'e\' nulla che distingua l\'offerta', () => {
		expect(offerKey({})).toBe('default');
		expect(offerKey({ variant: {}, seller: null, condition: null })).toBe('default');
	});

	it('e\' stabile: stessi attributi, stessa chiave', () => {
		const a = offerKey({ variant: { memoria: '256GB' }, condition: 'ottimo' });
		const b = offerKey({ variant: { memoria: '256GB' }, condition: 'ottimo' });
		expect(a).toBe(b);
	});

	it('non dipende dall\'ordine degli attributi', () => {
		const a = offerKey({ variant: { colore: 'nero', memoria: '256GB' } });
		const b = offerKey({ variant: { memoria: '256GB', colore: 'nero' } });
		expect(a).toBe(b);
	});

	it('ignora maiuscole e spazi in eccesso', () => {
		const a = offerKey({ variant: { Memoria: ' 256GB ' } });
		const b = offerKey({ variant: { memoria: '256gb' } });
		expect(a).toBe(b);
	});

	it('distingue varianti diverse', () => {
		// E' il punto: senza questa distinzione la storia prezzi di un
		// ricondizionato mescola tagli di memoria diversi.
		const a = offerKey({ variant: { memoria: '256GB' }, condition: 'grado a' });
		const b = offerKey({ variant: { memoria: '128GB' }, condition: 'grado a' });
		const c = offerKey({ variant: { memoria: '256GB' }, condition: 'grado c' });

		expect(new Set([a, b, c]).size).toBe(3);
	});

	it('distingue venditori diversi sullo stesso prodotto', () => {
		expect(offerKey({ seller: 'Venditore A' })).not.toBe(offerKey({ seller: 'Venditore B' }));
	});

	it('ignora gli attributi vuoti', () => {
		expect(offerKey({ variant: { colore: '', memoria: null } })).toBe('default');
	});
});

describe('describeOffer', () => {
	it('unisce variante da URL e da pagina', () => {
		const offer = describeOffer(
			{ seller: 'Back Market', condition: 'RefurbishedCondition', gtin: '019', sku: 'A1' },
			'https://www.backmarket.it/p/iphone?variant=256gb&utm_source=x',
		);

		expect(offer.variant.variant).toBe('256gb');
		expect(offer.seller).toBe('Back Market');
		expect(offer.condition).toBe('RefurbishedCondition');
		expect(offer.gtin).toBe('019');
		expect(offer.url).not.toContain('utm_source');
		expect(offer.offerKey).not.toBe('default');
	});

	it('per una pagina senza varianti produce l\'offerta default', () => {
		const offer = describeOffer({}, 'https://shop.it/p');
		expect(offer.offerKey).toBe('default');
	});

	it('la variante letta dalla pagina ha la precedenza su quella dell\'URL', () => {
		const offer = describeOffer(
			{ variant: { variant: 'letto-dalla-pagina' } },
			'https://shop.it/p?variant=dall-url',
		);
		expect(offer.variant.variant).toBe('letto-dalla-pagina');
	});
});
