import { describe, it, expect } from 'vitest';
import price from '../../scrape/normalize/price.js';

const { parsePrice, parsePriceDetailed, REASONS } = price;

describe('parsePrice - formati per locale', () => {
	const cases = [
		// [input,                    atteso,      descrizione]
		['729',                        729,        'intero nudo'],
		['729.00',                     729,        'decimale con punto'],
		['729,00',                     729,        'decimale con virgola (IT)'],
		['0,99',                       0.99,       'sotto l\'unita\', virgola'],
		['0.99',                       0.99,       'sotto l\'unita\', punto'],
		['12,5',                       12.5,       'un solo decimale'],
		['1.234,56',                   1234.56,    'migliaia punto, decimale virgola (IT/DE)'],
		['1,234.56',                   1234.56,    'migliaia virgola, decimale punto (EN)'],
		['1 234,56',                   1234.56,    'migliaia spazio (FR)'],
		['1 234,56',              1234.56,    'migliaia spazio unificatore'],
		['1 234,56',              1234.56,    'migliaia spazio stretto'],
		["1'234.56",                   1234.56,    'migliaia apostrofo (CH)'],
		['1’234.56',              1234.56,    'migliaia apostrofo tipografico'],
		['1.234.567,89',               1234567.89, 'migliaia multiple, decimale virgola'],
		['1,234,567.89',               1234567.89, 'migliaia multiple, decimale punto'],
		['1.234',                      1234,       'separatore unico con 3 cifre = migliaia'],
		['1,234',                      1234,       'idem con virgola'],
		['12.345',                     12345,      'migliaia a 5 cifre'],
	];

	for (const [input, expected, label] of cases) {
		it(`${label}: ${JSON.stringify(input)} -> ${expected}`, () => {
			expect(parsePrice(input)).toBe(expected);
		});
	}
});

describe('parsePrice - simboli, valute e rumore', () => {
	const cases = [
		['€ 729,00',        729,      'simbolo prefisso con spazio'],
		['€729,00',         729,      'simbolo prefisso attaccato'],
		['729,00 €',        729,      'simbolo suffisso'],
		['729,00€',         729,      'simbolo suffisso attaccato'],
		['$1,299.99',       1299.99,  'dollaro'],
		['£1,299.99',       1299.99,  'sterlina'],
		['1 299,99 CHF',    1299.99,  'codice valuta suffisso'],
		['EUR 729.00',      729,      'codice valuta prefisso'],
		['729.00 EUR',      729,      'codice valuta suffisso'],
		['Prezzo: 729,00 euro', 729,  'testo attorno al numero'],
		['  729,00  ',      729,      'spazi in eccesso'],
	];

	for (const [input, expected, label] of cases) {
		it(`${label}: ${JSON.stringify(input)} -> ${expected}`, () => {
			expect(parsePrice(input)).toBe(expected);
		});
	}
});

describe('parsePrice - input numerici', () => {
	it('accetta un numero gia\' pronto', () => {
		expect(parsePrice(729)).toBe(729);
		expect(parsePrice(729.99)).toBe(729.99);
	});

	it('arrotonda al centesimo', () => {
		expect(parsePrice(729.999)).toBe(730);
		expect(parsePrice(0.005)).toBe(0.01);
		expect(parsePrice(12.344)).toBe(12.34);
		expect(parsePrice('1.234,567')).toBe(1234.57);
	});

	it('interpreta i centesimi interi quando richiesto (formato Shopify)', () => {
		expect(parsePrice(72900, { cents: true })).toBe(729);
		expect(parsePrice('12990', { cents: true })).toBe(129.9);
	});
});

describe('parsePrice - input che non sono prezzi', () => {
	const rejected = [
		[null,                REASONS.EMPTY,       'null'],
		[undefined,           REASONS.EMPTY,       'undefined'],
		['',                  REASONS.EMPTY,       'stringa vuota'],
		['   ',               REASONS.EMPTY,       'soli spazi'],
		['Non disponibile',   REASONS.NOT_A_PRICE, 'testo senza cifre'],
		['N/A',               REASONS.NOT_A_PRICE, 'segnaposto'],
		['-20%',              REASONS.PERCENTAGE,  'percentuale di sconto'],
		['sconto del 15%',    REASONS.PERCENTAGE,  'percentuale nel testo'],
		['-15,00',            REASONS.NEGATIVE,    'valore negativo'],
		['0',                 REASONS.ZERO,        'zero'],
		['0,00',              REASONS.ZERO,        'zero con decimali'],
		[NaN,                 REASONS.NOT_FINITE,  'NaN'],
		[Infinity,            REASONS.NOT_FINITE,  'Infinity'],
		['99999999999',       REASONS.TOO_LARGE,   'oltre il tetto di plausibilita\''],
	];

	for (const [input, reason, label] of rejected) {
		it(`rifiuta ${label} con motivo ${reason}`, () => {
			const result = parsePriceDetailed(input);
			expect(result.value).toBeNull();
			expect(result.reason).toBe(reason);
		});
	}

	it('restituisce null e non 0, a differenza della vecchia implementazione', () => {
		// Le tre versioni precedenti restituivano 0 su input non parsabile,
		// rendendo indistinguibile "gratis" da "scrape fallito".
		expect(parsePrice('Non disponibile')).toBeNull();
		expect(parsePrice('')).toBeNull();
	});

	it('accetta zero quando il chiamante lo dichiara valido', () => {
		expect(parsePrice('0,00', { allowZero: true })).toBe(0);
	});

	it('rispetta un tetto personalizzato', () => {
		expect(parsePrice('5000', { maxValue: 1000 })).toBeNull();
		expect(parsePrice('500', { maxValue: 1000 })).toBe(500);
	});
});

describe('parsePrice - intervalli di prezzo', () => {
	it('prende il primo valore e segnala l\'intervallo', () => {
		const result = parsePriceDetailed('da € 199,00 a € 249,00');
		expect(result.value).toBe(199);
		expect(result.hadRange).toBe(true);
	});

	it('non segnala intervallo su un prezzo singolo', () => {
		expect(parsePriceDetailed('€ 199,00').hadRange).toBe(false);
	});
});

describe('parsePrice - ambiguita\' dichiarate', () => {
	// Un separatore unico seguito da 3 cifre e' irriducibilmente ambiguo:
	// "1.234" puo' essere milleduecentotrentaquattro o uno-virgola-due-tre-quattro.
	// La convenzione dei prezzi dice migliaia, e la regola vale in modo uniforme
	// per punto e virgola. Questi test fissano la scelta perche' sia una
	// decisione visibile e non un effetto collaterale.
	it('legge tre cifre dopo un separatore unico come migliaia', () => {
		expect(parsePrice('1.234')).toBe(1234);
		expect(parsePrice('1,234')).toBe(1234);
		expect(parsePrice('12.344')).toBe(12344);
	});

	it('legge una o due cifre dopo un separatore unico come decimali', () => {
		expect(parsePrice('1.23')).toBe(1.23);
		expect(parsePrice('1,2')).toBe(1.2);
	});

	it('con entrambi i separatori non c\'e\' ambiguita\': vince l\'ultimo', () => {
		expect(parsePrice('1.234,56')).toBe(1234.56);
		expect(parsePrice('1,234.56')).toBe(1234.56);
	});
});

describe('parsePrice - casi che rompevano le vecchie implementazioni', () => {
	it('non confonde 1.234 con 1 euro e 23', () => {
		expect(parsePrice('1.234')).toBe(1234);
	});

	it('non tronca 1,234.56 a 1', () => {
		expect(parsePrice('1,234.56')).toBe(1234.56);
	});

	it('gestisce il formato di BackMarket "€ 259,00"', () => {
		expect(parsePrice('€ 259,00')).toBe(259);
	});

	it('gestisce un prezzo Amazon con testo di contorno', () => {
		expect(parsePrice('1.099,00 €')).toBe(1099);
	});

	it('e\' idempotente su un valore gia\' normalizzato', () => {
		const once = parsePrice('1.234,56');
		expect(parsePrice(once)).toBe(once);
	});
});
