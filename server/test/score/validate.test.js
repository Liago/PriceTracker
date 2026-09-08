import { describe, it, expect } from 'vitest';
import validateModule from '../../scrape/score/validate.js';

const { validatePrice, nextTrackingHealth, isFlapping, median, OUTCOME, REJECT } = validateModule;

/** Storico sintetico: prezzi dal piu' recente, a un giorno di distanza. */
function history(...prices) {
	return prices.map((price, index) => ({
		price,
		observedAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
	}));
}

const base = (overrides = {}) => ({
	price: 729,
	currency: 'EUR',
	availability: 'in_stock',
	confidence: 0.9,
	history: history(729, 730, 728, 731, 729),
	...overrides,
});

describe('median', () => {
	it('calcola la mediana di serie pari e dispari', () => {
		expect(median([1, 2, 3])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(median([])).toBeNull();
	});
});

describe('validatePrice - accettazione', () => {
	it('accetta un prezzo coerente con confidenza alta', () => {
		const out = validatePrice(base());
		expect(out.outcome).toBe(OUTCOME.ACCEPTED);
		expect(out.accepted).toBe(true);
		expect(out.reasons).toEqual([]);
	});

	it('accetta un prodotto senza storico', () => {
		// Il primo controllo di un prodotto nuovo non ha nulla con cui
		// confrontarsi: non e' un motivo per rifiutare.
		const out = validatePrice(base({ history: [] }));
		expect(out.accepted).toBe(true);
	});

	it('accetta una variazione contenuta', () => {
		const out = validatePrice(base({ price: 649 }));
		expect(out.accepted).toBe(true);
		expect(out.checks.deltaRatio).toBeLessThan(0.6);
	});
});

describe('validatePrice - controllo 1: intervallo assoluto', () => {
	it('rifiuta valori nulli o negativi', () => {
		expect(validatePrice(base({ price: 0 })).reasons).toContain(REJECT.OUT_OF_RANGE);
		expect(validatePrice(base({ price: -5 })).reasons).toContain(REJECT.OUT_OF_RANGE);
	});

	it('rifiuta valori oltre il tetto', () => {
		expect(validatePrice(base({ price: 99999999 })).reasons).toContain(REJECT.OUT_OF_RANGE);
	});
});

describe('validatePrice - controllo 2: confidenza', () => {
	it('manda in quarantena sotto la soglia condizionale', () => {
		const out = validatePrice(base({ confidence: 0.4 }));
		expect(out.outcome).toBe(OUTCOME.QUARANTINED);
		expect(out.reasons).toContain(REJECT.LOW_CONFIDENCE);
	});

	it('accetta fra soglia condizionale e soglia piena se i controlli passano', () => {
		const out = validatePrice(base({ confidence: 0.7 }));
		expect(out.accepted).toBe(true);
	});
});

describe('validatePrice - controllo 3: identita\'', () => {
	it('rifiuta se il GTIN letto differisce da quello storico', () => {
		// Non e' un prezzo sbagliato: e' un altro prodotto. Un redirect, un
		// ritiro dal catalogo, una pagina riusata.
		const out = validatePrice(base({
			identity: { gtin: '0000000000000' },
			knownIdentity: { gtin: '0194253000000' },
		}));
		expect(out.outcome).toBe(OUTCOME.QUARANTINED);
		expect(out.reasons).toContain(REJECT.IDENTITY_CHANGED);
	});

	it('rifiuta anche su SKU diverso', () => {
		const out = validatePrice(base({ identity: { sku: 'B' }, knownIdentity: { sku: 'A' } }));
		expect(out.reasons).toContain(REJECT.IDENTITY_CHANGED);
	});

	it('non si lamenta se uno dei due manca', () => {
		expect(validatePrice(base({ identity: {}, knownIdentity: { gtin: 'X' } })).accepted).toBe(true);
		expect(validatePrice(base({ identity: { gtin: 'X' }, knownIdentity: {} })).accepted).toBe(true);
	});
});

describe('validatePrice - controllo 4: valuta', () => {
	it('rifiuta un cambio di valuta rispetto allo storico', () => {
		// Sintomo classico di geo-redirect o di blocco preso per un altro.
		const out = validatePrice(base({ currency: 'USD', knownCurrency: 'EUR' }));
		expect(out.outcome).toBe(OUTCOME.QUARANTINED);
		expect(out.reasons).toContain(REJECT.CURRENCY_CHANGED);
	});

	it('accetta la prima valuta osservata', () => {
		expect(validatePrice(base({ currency: 'GBP', knownCurrency: null })).accepted).toBe(true);
	});
});

describe('validatePrice - controllo 5: variazione rispetto allo storico', () => {
	it('chiede conferma su un crollo oltre il 60%', () => {
		const out = validatePrice(base({ price: 99, confidence: 0.7 }));
		expect(out.outcome).toBe(OUTCOME.NEEDS_CONFIRMATION);
		expect(out.accepted).toBe(false);
		expect(out.reasons).toContain(REJECT.DELTA_IMPLAUSIBLE);
	});

	it('accetta il crollo se la confidenza e\' molto alta', () => {
		// Un Black Friday vero passa; un selettore sbagliato quasi mai arriva
		// a 0,90 di confidenza.
		const out = validatePrice(base({ price: 99, confidence: 0.95 }));
		expect(out.accepted).toBe(true);
	});

	it('accetta il crollo dopo un secondo fetch di conferma', () => {
		const out = validatePrice(base({ price: 99, confidence: 0.7, confirmed: true }));
		expect(out.accepted).toBe(true);
	});

	it('usa la mediana e non l\'ultimo valore, per non farsi sviare da un singolo errore', () => {
		// Un valore anomalo nello storico non deve spostare il riferimento.
		const out = validatePrice(base({ price: 720, history: history(729, 4.99, 731, 728, 730) }));
		expect(out.accepted).toBe(true);
	});

	it('un prezzo di spedizione letto per errore viene fermato', () => {
		// Il caso reale: lo scraper aggancia "4,99 €" invece del prezzo.
		const out = validatePrice(base({ price: 4.99, confidence: 0.7 }));
		expect(out.accepted).toBe(false);
		expect(out.reasons).toContain(REJECT.DELTA_IMPLAUSIBLE);
	});
});

describe('validatePrice - controllo 6: instabilita\'', () => {
	it('riconosce un\'alternanza A-B-A-B recente', () => {
		const alternato = [
			{ price: 649, observedAt: new Date(Date.now() - 1 * 3600000).toISOString() },
			{ price: 729, observedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
			{ price: 649, observedAt: new Date(Date.now() - 6 * 3600000).toISOString() },
		];
		expect(isFlapping(alternato, 729)).toBe(true);
	});

	it('non segnala una serie stabile o una discesa progressiva', () => {
		expect(isFlapping(history(729, 729, 729), 729)).toBe(false);
		expect(isFlapping(history(729, 749, 799), 699)).toBe(false);
	});

	it('ignora le alternanze piu' + ' vecchie della finestra', () => {
		const vecchio = [
			{ price: 649, observedAt: new Date(Date.now() - 100 * 3600000).toISOString() },
			{ price: 729, observedAt: new Date(Date.now() - 120 * 3600000).toISOString() },
			{ price: 649, observedAt: new Date(Date.now() - 140 * 3600000).toISOString() },
		];
		expect(isFlapping(vecchio, 729)).toBe(false);
	});

	it('manda in quarantena un valore instabile a bassa confidenza', () => {
		const alternato = [
			{ price: 649, observedAt: new Date(Date.now() - 1 * 3600000).toISOString() },
			{ price: 729, observedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
			{ price: 649, observedAt: new Date(Date.now() - 6 * 3600000).toISOString() },
		];
		const out = validatePrice(base({ price: 729, confidence: 0.7, history: alternato }));
		expect(out.reasons).toContain(REJECT.FLAPPING);
	});

	it('non penalizza l\'instabilita\' quando la confidenza e\' molto alta', () => {
		const alternato = [
			{ price: 649, observedAt: new Date(Date.now() - 1 * 3600000).toISOString() },
			{ price: 729, observedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
			{ price: 649, observedAt: new Date(Date.now() - 6 * 3600000).toISOString() },
		];
		const out = validatePrice(base({ price: 729, confidence: 0.95, history: alternato }));
		expect(out.reasons).not.toContain(REJECT.FLAPPING);
	});
});

describe('validatePrice - assenza di prezzo', () => {
	it('segnala l\'incoerenza di un prodotto disponibile senza prezzo', () => {
		const out = validatePrice(base({ price: null, availability: 'in_stock' }));
		expect(out.reasons).toContain(REJECT.IN_STOCK_WITHOUT_PRICE);
		expect(out.accepted).toBe(false);
	});

	it('per un esaurito senza prezzo basta constatarlo', () => {
		const out = validatePrice(base({ price: null, availability: 'out_of_stock' }));
		expect(out.reasons).toContain(REJECT.NO_PRICE);
	});

	it('regge input assente', () => {
		expect(validatePrice(null).accepted).toBe(false);
		expect(validatePrice(undefined).accepted).toBe(false);
	});
});

describe('nextTrackingHealth', () => {
	it('un successo riporta a healthy e azzera i fallimenti', () => {
		expect(nextTrackingHealth({ outcome: OUTCOME.ACCEPTED, consecutiveFailures: 5 }))
			.toEqual({ health: 'healthy', consecutiveFailures: 0 });
	});

	it('un fallimento isolato e\' degraded, non broken', () => {
		// Puo' essere una pagina lenta o un intoppo di rete.
		expect(nextTrackingHealth({ outcome: OUTCOME.QUARANTINED, consecutiveFailures: 0 }).health)
			.toBe('degraded');
	});

	it('tre fallimenti consecutivi sono broken', () => {
		expect(nextTrackingHealth({ outcome: OUTCOME.QUARANTINED, consecutiveFailures: 2 }).health)
			.toBe('broken');
	});

	it('un cambio di identita\' e\' degraded a prescindere', () => {
		expect(nextTrackingHealth({ outcome: OUTCOME.ACCEPTED, identityChanged: true }).health)
			.toBe('degraded');
	});

	it('un dominio bloccato ha uno stato suo', () => {
		expect(nextTrackingHealth({ outcome: OUTCOME.QUARANTINED, blocked: true }).health)
			.toBe('blocked');
	});
});
