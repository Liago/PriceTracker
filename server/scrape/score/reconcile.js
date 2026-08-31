/**
 * Riconciliazione e calcolo della confidenza.
 *
 * Gli estrattori producono candidati in concorrenza; qui si decide quale vince
 * per ogni campo e quanto ci si fida del risultato. La confidenza non e' un
 * ornamento: e' cio' che, in fase 4, decidera' se un prezzo entra nella storia
 * o finisce in quarantena.
 *
 * La formula segue la sezione 8.2 del design doc.
 */

/** Due prezzi coincidono se differiscono per meno di un centesimo. */
const PRICE_EPSILON = 0.005;

/** Differenza di peso sotto la quale due candidati sono "comparabili". */
const COMPARABLE_WEIGHT_DELTA = 0.10;

const CONFIDENCE = Object.freeze({
	// I bonus consumano una frazione dello SPAZIO RESIDUO fino a 1, non una
	// quantita' fissa. Con bonus additivi un JSON-LD (0,90) piu' una sola
	// conferma toccherebbe gia' 1,000, e da li' in poi ogni ulteriore accordo
	// non cambierebbe nulla: due sorgenti concordi e quattro risulterebbero
	// egualmente certe. Consumando lo spazio residuo la scala resta monotona e
	// non satura mai davvero.
	AGREEMENT_HEADROOM_SHARE: 0.5,   // ogni accordo prende meta' dello spazio rimasto
	CURRENCY_HEADROOM_SHARE: 0.25,
	COMPETING_PENALTY: 0.20,
	NOT_A_PRODUCT_PAGE: 0.25,
	ANTI_BOT: 0.30,
});

/** Due valori dello stesso campo sono lo stesso valore? */
function sameValue(field, a, b) {
	if (field === 'price') {
		return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < PRICE_EPSILON;
	}
	return a === b;
}

/**
 * Sceglie il candidato vincente per un campo.
 *
 * @param {Array} candidates - candidati dello stesso campo
 * @returns {{winner: object, agreeingSources: Array<string>, competing: Array<object>}|null}
 */
function reconcileField(field, candidates) {
	if (!candidates || candidates.length === 0) return null;

	const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
	const winner = ranked[0];

	const agreeingSources = [...new Set(
		ranked.filter((c) => sameValue(field, c.value, winner.value)).map((c) => c.source)
	)];

	// Concorrenti: valore diverso e peso comparabile. Un candidato molto piu'
	// debole non mette in dubbio il vincitore.
	const competing = ranked.filter((c) =>
		!sameValue(field, c.value, winner.value)
		&& (winner.weight - c.weight) < COMPARABLE_WEIGHT_DELTA
	);

	return { winner, agreeingSources, competing };
}

/**
 * @param {Array} candidates - tutti i candidati di tutti gli estrattori
 * @param {object} [context]
 * @param {boolean} [context.antiBotDetected=false]
 * @returns {{fields: object, result: object, confidence: number, signals: Array<string>}}
 */
function reconcile(candidates, context = {}) {
	const { antiBotDetected = false } = context;

	const byField = new Map();
	for (const candidate of candidates || []) {
		if (!candidate || !candidate.field) continue;
		if (!byField.has(candidate.field)) byField.set(candidate.field, []);
		byField.get(candidate.field).push(candidate);
	}

	const fields = {};
	const result = {};
	for (const [field, fieldCandidates] of byField) {
		const resolved = reconcileField(field, fieldCandidates);
		if (!resolved) continue;
		fields[field] = {
			value: resolved.winner.value,
			raw: resolved.winner.raw,
			source: resolved.winner.source,
			path: resolved.winner.path,
			evidence: resolved.winner.evidence,
			weight: resolved.winner.weight,
			// Il localizzatore deve sopravvivere alla riconciliazione: e' cio'
			// che il learner salva nella ricetta. Senza, il campo risolto
			// descrive il risultato ma non sa rifarlo.
			locator: resolved.winner.locator || null,
			agreeingSources: resolved.agreeingSources,
			competingCount: resolved.competing.length,
			meta: resolved.winner.meta,
		};
		result[field] = resolved.winner.value;
	}

	// --- Confidenza, calcolata sul campo prezzo ---
	const signals = [];
	const price = fields.price;

	if (!price) {
		return { fields, result, confidence: 0, signals: ['nessun-prezzo'] };
	}

	const base = price.weight;
	let headroom = 1 - base;
	let gained = 0;

	signals.push(`sorgente:${price.source}`);

	const independentAgreements = Math.max(0, price.agreeingSources.length - 1);
	for (let i = 0; i < independentAgreements; i++) {
		const step = (headroom - gained) * CONFIDENCE.AGREEMENT_HEADROOM_SHARE;
		gained += step;
	}
	if (independentAgreements > 0) {
		signals.push(`accordo:${price.agreeingSources.join('+')}`);
	}

	const currency = fields.currency;
	if (currency && currency.agreeingSources.length >= 2) {
		gained += (headroom - gained) * CONFIDENCE.CURRENCY_HEADROOM_SHARE;
		signals.push('valuta-confermata');
	}

	let confidence = base + gained;

	if (price.competingCount > 0) {
		confidence -= CONFIDENCE.COMPETING_PENALTY;
		signals.push(`concorrenti:${price.competingCount}`);
	}

	// Una pagina prodotto ha un titolo e un'immagine. Senza, molto
	// probabilmente non e' una scheda prodotto: una categoria, un carrello, una
	// pagina di errore travestita da 200.
	if (!fields.title || !fields.image) {
		confidence -= CONFIDENCE.NOT_A_PRODUCT_PAGE;
		signals.push('non-sembra-una-scheda-prodotto');
	}

	if (antiBotDetected) {
		confidence -= CONFIDENCE.ANTI_BOT;
		signals.push('anti-bot');
	}

	// L'estrattore DOM segnala da solo quando la sua scelta non e' netta.
	if (price.source === 'dom' && price.meta && price.meta.ambiguous) {
		confidence -= CONFIDENCE.COMPETING_PENALTY;
		signals.push('dom-ambiguo');
	}

	confidence = Math.max(0, Math.min(1, confidence));

	return {
		fields,
		result,
		confidence: Math.round(confidence * 1000) / 1000,
		signals,
	};
}

module.exports = { reconcile, reconcileField, sameValue, CONFIDENCE, PRICE_EPSILON, COMPARABLE_WEIGHT_DELTA };
