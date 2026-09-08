import { describe, it, expect, vi, afterEach } from 'vitest';
import telemetry from '../scrape/telemetry.js';

const { emit, recordCheck, recordRecipeTransition, summarize, ALERT, PREFIX } = telemetry;

afterEach(() => vi.restoreAllMocks());

/** Cattura le righe di metrica emesse. */
function capture(fn) {
	const lines = [];
	vi.spyOn(console, 'log').mockImplementation((line) => lines.push(line));
	fn();
	return lines.map((line) => JSON.parse(line.replace(`${PREFIX} `, '')));
}

describe('emit', () => {
	it('emette una riga JSON con prefisso stabile', () => {
		const [metric] = capture(() => emit('test.metrica', { valore: 1 }));
		expect(metric.metric).toBe('test.metrica');
		expect(metric.valore).toBe(1);
		expect(metric.at).toBeTruthy();
	});
});

describe('recordCheck', () => {
	it('registra l\'esito di un controllo', () => {
		const [metric] = capture(() => recordCheck({
			domain: 'shop.it', accepted: true, confidence: 0.92, source: 'jsonld',
			usedFastPath: true, durationMs: 1200,
		}));

		expect(metric.metric).toBe('scrape.check');
		expect(metric.accepted).toBe(true);
		expect(metric.fastPath).toBe(true);
	});

	it('include i motivi solo quando ce ne sono', () => {
		const [conMotivi] = capture(() => recordCheck({ domain: 'x.it', accepted: false, reasons: ['fuori_intervallo'] }));
		const [senzaMotivi] = capture(() => recordCheck({ domain: 'x.it', accepted: true }));

		expect(conMotivi.reasons).toEqual(['fuori_intervallo']);
		expect(senzaMotivi.reasons).toBeUndefined();
	});
});

describe('recordRecipeTransition', () => {
	it('emette un allarme quando una ricetta va in quarantena', () => {
		const metrics = capture(() => recordRecipeTransition({
			domain: 'shop.it', from: 'active', to: 'quarantined', version: 3,
		}));

		expect(metrics.map((m) => m.metric)).toContain('alert.recipe_quarantined');
	});

	it('una promozione non genera allarmi', () => {
		const metrics = capture(() => recordRecipeTransition({
			domain: 'shop.it', from: 'candidate', to: 'active', version: 2,
		}));

		expect(metrics.filter((m) => m.metric.startsWith('alert.'))).toHaveLength(0);
	});
});

describe('summarize', () => {
	const check = (domain, accepted, extra = {}) => ({ domain, accepted, confidence: 0.9, ...extra });

	it('calcola il tasso di successo complessivo e per dominio', () => {
		const out = summarize([
			check('a.it', true), check('a.it', true), check('a.it', false),
			check('b.it', true),
		]);

		expect(out.total).toBe(4);
		expect(out.successRate).toBe(0.75);
		expect(out.byDomain['a.it'].successRate).toBeCloseTo(0.667, 2);
		expect(out.byDomain['b.it'].successRate).toBe(1);
	});

	it('misura quanto spesso si e\' usato il fast path', () => {
		const out = summarize([
			check('a.it', true, { usedFastPath: true }),
			check('a.it', true, { usedFastPath: true }),
			check('a.it', true, { usedFastPath: false }),
			check('a.it', true, { usedFastPath: false }),
		]);
		expect(out.fastPathRatio).toBe(0.5);
	});

	it('segnala un dominio in difficolta\'', () => {
		const checks = Array.from({ length: 12 }, (_, i) => check('rotto.it', i < 3));
		const out = summarize(checks);

		const allarme = out.alerts.find((a) => a.type === 'dominio_in_difficolta');
		expect(allarme).toBeDefined();
		expect(allarme.domain).toBe('rotto.it');
	});

	it('NON segnala con troppe poche esecuzioni', () => {
		// Due fallimenti su tre controlli non dicono nulla; cinquanta su cento si'.
		const out = summarize([check('a.it', false), check('a.it', false), check('a.it', true)]);
		expect(out.alerts.filter((a) => a.type === 'dominio_in_difficolta')).toHaveLength(0);
	});

	it('segnala quando troppe osservazioni finiscono in quarantena', () => {
		const checks = Array.from({ length: 20 }, (_, i) => check('a.it', i > 2));
		const out = summarize(checks);
		expect(out.alerts.some((a) => a.type === 'troppe_quarantene')).toBe(true);
	});

	it('regge un elenco vuoto', () => {
		const out = summarize([]);
		expect(out.total).toBe(0);
		expect(out.successRate).toBeNull();
		expect(out.alerts).toEqual([]);
	});
});
