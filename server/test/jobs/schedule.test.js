import { describe, it, expect } from 'vitest';
import scheduleModule from '../../scrape/jobs/schedule.js';

const { isDue, intervalFor, priorityOf, LIMITS } = scheduleModule;

const now = new Date('2026-08-31T12:00:00Z');
const minutesAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();

describe('priorityOf', () => {
	it('un prodotto mai controllato viene prima di tutti', () => {
		// Senza un primo prezzo non c'e' nulla da mostrare all'utente.
		expect(priorityOf({})).toBeLessThan(priorityOf({ last_checked_at: minutesAgo(10) }));
	});

	it('un prodotto con soglia ha la precedenza su uno senza', () => {
		expect(priorityOf({ last_checked_at: minutesAgo(10), target_price: 100 }))
			.toBeLessThan(priorityOf({ last_checked_at: minutesAgo(10) }));
	});

	it('un prodotto rotto va in fondo', () => {
		expect(priorityOf({ last_checked_at: minutesAgo(10), tracking_health: 'broken' }))
			.toBeGreaterThan(priorityOf({ last_checked_at: minutesAgo(10) }));
	});
});

describe('intervalFor', () => {
	it('usa l\'intervallo dell\'utente quando non c\'e\' motivo di scostarsene', () => {
		const out = intervalFor({ last_checked_at: minutesAgo(10) }, 360, { now });
		expect(out.minutes).toBe(360);
		expect(out.reason).toBe('intervallo-utente');
	});

	it('dirada i prodotti fermi da un mese', () => {
		const out = intervalFor({ last_success_at: daysAgo(45) }, 360, { now });
		expect(out.minutes).toBe(720);
		expect(out.reason).toBe('prezzo-fermo');
	});

	it('infittisce i prezzi volatili, ma mai sotto il pavimento', () => {
		expect(intervalFor({ price_volatile: true }, 360, { now }).minutes).toBe(180);
		expect(intervalFor({ price_volatile: true }, 20, { now }).minutes).toBe(LIMITS.MIN_INTERVAL_MINUTES);
	});

	it('applica un backoff esponenziale ai prodotti rotti', () => {
		// Non ha senso interrogare ogni ora una pagina che non risponde da giorni.
		const uno = intervalFor({ tracking_health: 'broken', consecutive_failures: 1 }, 60, { now });
		const tre = intervalFor({ tracking_health: 'broken', consecutive_failures: 3 }, 60, { now });

		expect(uno.minutes).toBe(120);
		expect(tre.minutes).toBe(480);
		expect(tre.reason).toBe('backoff-fallimenti');
	});

	it('non supera mai il tetto massimo', () => {
		const out = intervalFor({ tracking_health: 'broken', consecutive_failures: 20 }, 360, { now });
		expect(out.minutes).toBe(LIMITS.MAX_INTERVAL_MINUTES);
	});

	it('un dominio bloccato va all\'intervallo massimo', () => {
		expect(intervalFor({ tracking_health: 'blocked' }, 60, { now }).minutes)
			.toBe(LIMITS.MAX_INTERVAL_MINUTES);
	});
});

describe('isDue', () => {
	it('un prodotto mai controllato e\' sempre dovuto', () => {
		const out = isDue({}, 360, { now });
		expect(out.due).toBe(true);
		expect(out.reason).toBe('mai-controllato');
	});

	it('rispetta l\'intervallo', () => {
		expect(isDue({ last_checked_at: minutesAgo(10) }, 360, { now }).due).toBe(false);
		expect(isDue({ last_checked_at: minutesAgo(400) }, 360, { now }).due).toBe(true);
	});

	it('un prodotto rotto aspetta piu\' a lungo di uno sano', () => {
		const sano = { last_checked_at: minutesAgo(90) };
		const rotto = { last_checked_at: minutesAgo(90), tracking_health: 'broken', consecutive_failures: 2 };

		expect(isDue(sano, 60, { now }).due).toBe(true);
		expect(isDue(rotto, 60, { now }).due).toBe(false);
	});

	it('riporta quando sara\' dovuto', () => {
		const out = isDue({ last_checked_at: minutesAgo(10) }, 60, { now });
		expect(out.dueAt.getTime()).toBe(new Date(minutesAgo(10)).getTime() + 60 * 60000);
	});
});
