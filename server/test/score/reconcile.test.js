import { describe, it, expect } from 'vitest';
import reconcileModule from '../../scrape/score/reconcile.js';
import candidateModule from '../../scrape/extract/candidate.js';

const { reconcile, sameValue } = reconcileModule;
const { candidate } = candidateModule;

const price = (value, source, extra = {}) => candidate({ field: 'price', value, source, ...extra });
const currency = (value, source) => candidate({ field: 'currency', value, source });
const identity = () => [
	candidate({ field: 'title', value: 'Prodotto', source: 'jsonld' }),
	candidate({ field: 'image', value: 'https://x.it/i.jpg', source: 'jsonld' }),
];

describe('sameValue', () => {
	it('confronta i prezzi al centesimo', () => {
		expect(sameValue('price', 729.00, 729.001)).toBe(true);
		expect(sameValue('price', 729.00, 729.01)).toBe(false);
	});

	it('confronta gli altri campi per uguaglianza', () => {
		expect(sameValue('currency', 'EUR', 'EUR')).toBe(true);
		expect(sameValue('currency', 'EUR', 'USD')).toBe(false);
	});
});

describe('reconcile - scelta del vincitore', () => {
	it('vince la sorgente col peso maggiore', () => {
		const { result, fields } = reconcile([
			price(999, 'dom'),
			price(729, 'jsonld'),
			price(899, 'meta'),
			...identity(),
		]);

		expect(result.price).toBe(729);
		expect(fields.price.source).toBe('jsonld');
	});

	it('riporta provenienza e percorso del vincitore', () => {
		const { fields } = reconcile([
			price(729, 'jsonld', { path: '$[0].offers.price', evidence: 'offers -> 729.00' }),
			...identity(),
		]);

		expect(fields.price.path).toBe('$[0].offers.price');
		expect(fields.price.evidence).toBe('offers -> 729.00');
	});

	it('senza candidati prezzo la confidenza e\' zero', () => {
		const { confidence, signals } = reconcile(identity());
		expect(confidence).toBe(0);
		expect(signals).toContain('nessun-prezzo');
	});

	it('regge un elenco vuoto o nullo', () => {
		expect(reconcile([]).confidence).toBe(0);
		expect(reconcile(null).confidence).toBe(0);
	});
});

describe('reconcile - confidenza', () => {
	it('parte dal peso della sorgente vincente', () => {
		const { confidence } = reconcile([price(729, 'jsonld'), ...identity()]);
		expect(confidence).toBe(0.9);
	});

	it('sale quando piu\' sorgenti indipendenti concordano', () => {
		const solo = reconcile([price(729, 'jsonld'), ...identity()]).confidence;
		const doppio = reconcile([price(729, 'jsonld'), price(729, 'microdata'), ...identity()]).confidence;
		const triplo = reconcile([
			price(729, 'jsonld'), price(729, 'microdata'), price(729, 'meta'), ...identity(),
		]);

		expect(doppio).toBeGreaterThan(solo);
		expect(triplo.confidence).toBeGreaterThan(doppio);
		expect(triplo.signals.some((s) => s.startsWith('accordo:'))).toBe(true);
	});

	it('non conta due volte la stessa sorgente', () => {
		const unaSorgente = reconcile([price(729, 'jsonld'), price(729, 'jsonld'), ...identity()]).confidence;
		const dueSorgenti = reconcile([price(729, 'jsonld'), price(729, 'microdata'), ...identity()]).confidence;
		expect(unaSorgente).toBeLessThan(dueSorgenti);
	});

	it('scende quando un candidato di peso comparabile propone un valore diverso', () => {
		const concorde = reconcile([price(729, 'jsonld'), price(729, 'microdata'), ...identity()]).confidence;
		const conteso = reconcile([price(729, 'jsonld'), price(649, 'jsonld'), ...identity()]);

		expect(conteso.confidence).toBeLessThan(concorde);
		expect(conteso.signals.some((s) => s.startsWith('concorrenti:'))).toBe(true);
	});

	it('ignora un concorrente troppo debole per contare', () => {
		// Un candidato DOM non mette in dubbio un JSON-LD.
		const { confidence, signals } = reconcile([price(729, 'jsonld'), price(9.9, 'dom'), ...identity()]);
		expect(signals.some((s) => s.startsWith('concorrenti:'))).toBe(false);
		expect(confidence).toBeGreaterThanOrEqual(0.9);
	});

	it('penalizza una pagina che non sembra una scheda prodotto', () => {
		const conIdentita = reconcile([price(729, 'jsonld'), ...identity()]).confidence;
		const senzaIdentita = reconcile([price(729, 'jsonld')]);

		expect(senzaIdentita.confidence).toBeLessThan(conIdentita);
		expect(senzaIdentita.signals).toContain('non-sembra-una-scheda-prodotto');
	});

	it('penalizza i segnali anti-bot', () => {
		const pulito = reconcile([price(729, 'jsonld'), ...identity()]).confidence;
		const bloccato = reconcile([price(729, 'jsonld'), ...identity()], { antiBotDetected: true });

		expect(bloccato.confidence).toBeLessThan(pulito);
		expect(bloccato.signals).toContain('anti-bot');
	});

	it('penalizza un candidato DOM che si dichiara ambiguo', () => {
		const netto = reconcile([price(729, 'dom', { meta: { ambiguous: false } }), ...identity()]).confidence;
		const ambiguo = reconcile([price(729, 'dom', { meta: { ambiguous: true } }), ...identity()]);

		expect(ambiguo.confidence).toBeLessThan(netto);
		expect(ambiguo.signals).toContain('dom-ambiguo');
	});

	it('premia una valuta confermata da due sorgenti', () => {
		const una = reconcile([price(729, 'jsonld'), currency('EUR', 'jsonld'), ...identity()]).confidence;
		const due = reconcile([
			price(729, 'jsonld'), currency('EUR', 'jsonld'), currency('EUR', 'meta'), ...identity(),
		]);

		expect(due.confidence).toBeGreaterThan(una);
		expect(due.signals).toContain('valuta-confermata');
	});

	it('resta sempre fra 0 e 1', () => {
		const bassa = reconcile([price(729, 'dom', { meta: { ambiguous: true } }), price(1, 'dom')], {
			antiBotDetected: true,
		});
		expect(bassa.confidence).toBeGreaterThanOrEqual(0);

		const alta = reconcile([
			price(729, 'jsonld'), price(729, 'appstate'), price(729, 'microdata'), price(729, 'meta'),
			currency('EUR', 'jsonld'), currency('EUR', 'meta'), ...identity(),
		]);
		expect(alta.confidence).toBeLessThanOrEqual(1);
	});

	it('un solo estrattore DOM non raggiunge la soglia di accettazione', () => {
		// Soglia di progetto: 0,85. Il DOM da solo non deve poterla toccare.
		const { confidence } = reconcile([price(729, 'dom'), ...identity()]);
		expect(confidence).toBeLessThan(0.85);
	});
});
