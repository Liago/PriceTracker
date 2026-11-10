import { describe, it, expect } from 'vitest';
import productInfo from '../services/productInfo.js';

const { productInfoPatch } = productInfo;

describe('productInfoPatch', () => {
	const product = { id: 'p1', description: 'Testo completo della scheda prodotto.', brand: null,
		details: { variant: { color: 'Nero' }, specs: [{ name: 'Peso', value: '1 kg' }] } };

	it('aggiunge le informazioni nuove senza cancellare quelle precedenti', () => {
		const patch = productInfoPatch(product, { details: { features: ['Leggero'], specs: [] }, brand: 'Acme' }, { variant: { color: 'Nero' } });
		expect(patch.details).toEqual({ variant: { color: 'Nero' }, specs: [{ name: 'Peso', value: '1 kg' }], features: ['Leggero'] });
		expect(patch.brand).toBe('Acme');
	});

	it('non accorcia la descrizione', () => {
		expect(productInfoPatch(product, { description: 'Breve.' })).toBeNull();
		const patch = productInfoPatch(product, { description: 'Testo completo della scheda prodotto, con un paragrafo in più.' });
		expect(patch.description).toMatch(/paragrafo in più/);
	});

	it('non scrive nulla se la scheda non e cambiata', () => {
		expect(productInfoPatch(product, { details: { specs: [{ name: 'Peso', value: '1 kg' }] } })).toBeNull();
	});
});
