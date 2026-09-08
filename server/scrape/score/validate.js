/**
 * Validazione di plausibilita': la garanzia che il prezzo salvato sia quello
 * giusto.
 *
 * La confidenza dice quanto ci si fida dell'ESTRAZIONE; questi controlli
 * dicono se il valore ha senso rispetto a cio' che sappiamo del prodotto. Sono
 * cose diverse: un JSON-LD perfettamente formato puo' contenere un prezzo di
 * listino sbagliato, e un prezzo crollato del 90% puo' essere vero.
 *
 * Regola d'oro: un fallimento non scrive mai nulla su current_price. Oggi un
 * continue silenzioso lascia credere che il prezzo sia stabile quando in
 * realta' lo scraper e' rotto (difetto D8).
 */

const { AVAILABILITY } = require('../normalize/availability');

/** Soglie di confidenza, dalla sezione 8.2 del design doc. */
const THRESHOLDS = Object.freeze({
	ACCEPT: 0.85,       // si accetta senza altre verifiche
	CONDITIONAL: 0.60,  // si accetta solo se i controlli passano
});

const LIMITS = Object.freeze({
	MAX_PRICE: 10000000,
	// Variazione oltre la quale serve una conferma: non e' un rifiuto, e' una
	// richiesta di prova. Un crollo del Black Friday la supera, un selettore
	// sbagliato quasi mai.
	DELTA_RATIO: 0.6,
	DELTA_CONFIDENCE_OVERRIDE: 0.90,
	HISTORY_WINDOW: 5,
	FLAP_WINDOW_HOURS: 24,
	FLAP_MIN_ALTERNATIONS: 2,
	FLAP_MAX_CONFIDENCE: 0.9,
});

const OUTCOME = Object.freeze({
	ACCEPTED: 'accepted',
	QUARANTINED: 'quarantined',
	NEEDS_CONFIRMATION: 'needs_confirmation',
});

const REJECT = Object.freeze({
	NO_PRICE: 'nessun_prezzo',
	LOW_CONFIDENCE: 'confidenza_insufficiente',
	OUT_OF_RANGE: 'fuori_intervallo',
	DELTA_IMPLAUSIBLE: 'variazione_implausibile',
	CURRENCY_CHANGED: 'valuta_cambiata',
	IDENTITY_CHANGED: 'identita_cambiata',
	FLAPPING: 'valori_instabili',
	IN_STOCK_WITHOUT_PRICE: 'disponibile_senza_prezzo',
});

/** Mediana di una lista di numeri. */
function median(values) {
	if (!values || values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

/**
 * Rileva un'alternanza A-B-A-B, sintomo di estrazione instabile: un A/B test
 * dello store, oppure una variante che cambia a ogni caricamento.
 */
function isFlapping(history, candidatePrice, options = {}) {
	const {
		windowHours = LIMITS.FLAP_WINDOW_HOURS,
		minAlternations = LIMITS.FLAP_MIN_ALTERNATIONS,
	} = options;

	if (!history || history.length < 3) return false;

	const cutoff = Date.now() - windowHours * 3600 * 1000;
	const recent = history
		.filter((entry) => entry && entry.price !== null && new Date(entry.observedAt).getTime() >= cutoff)
		.map((entry) => entry.price);

	if (recent.length < 3) return false;

	const series = [candidatePrice, ...recent];
	const distinct = new Set(series);
	if (distinct.size !== 2) return false;

	let alternations = 0;
	for (let i = 1; i < series.length; i++) {
		if (series[i] !== series[i - 1]) alternations++;
	}
	return alternations >= minAlternations;
}

/**
 * @param {object} params
 * @param {number|null} params.price - prezzo candidato, gia' normalizzato
 * @param {string|null} [params.currency]
 * @param {string} [params.availability]
 * @param {number} params.confidence
 * @param {object} [params.identity] - {gtin, sku} letti dalla pagina
 * @param {object} [params.knownIdentity] - {gtin, sku} storici del prodotto
 * @param {string|null} [params.knownCurrency]
 * @param {Array<{price:number, observedAt:string}>} [params.history] - osservazioni
 *   accettate, dalla piu' recente
 * @param {boolean} [params.confirmed=false] - true al secondo fetch di conferma
 * @returns {{outcome: string, accepted: boolean, reasons: Array<string>, checks: object}}
 */
function validatePrice(params) {
	const {
		price,
		currency = null,
		availability = AVAILABILITY.UNKNOWN,
		confidence = 0,
		identity = {},
		knownIdentity = {},
		knownCurrency = null,
		history = [],
		confirmed = false,
	} = params || {};

	const reasons = [];
	const checks = {};

	// 0. Senza prezzo non c'e' nulla da validare.
	if (price === null || price === undefined) {
		// Disponibile ma senza prezzo e' incoerente; esaurito senza prezzo no.
		const inStockWithoutPrice = availability === AVAILABILITY.IN_STOCK;
		return {
			outcome: OUTCOME.QUARANTINED,
			accepted: false,
			reasons: [inStockWithoutPrice ? REJECT.IN_STOCK_WITHOUT_PRICE : REJECT.NO_PRICE],
			checks: { hasPrice: false },
		};
	}

	// 1. Intervallo assoluto.
	checks.range = price > 0 && price <= LIMITS.MAX_PRICE;
	if (!checks.range) reasons.push(REJECT.OUT_OF_RANGE);

	// 2. Confidenza minima.
	checks.confidence = confidence >= THRESHOLDS.CONDITIONAL;
	if (!checks.confidence) reasons.push(REJECT.LOW_CONFIDENCE);

	// 3. Coerenza di identita'. Se GTIN o SKU differiscono da quelli storici,
	// l'URL punta ormai a un altro prodotto: un redirect, un ritiro dal
	// catalogo, una pagina riusata. Non e' un prezzo sbagliato, e' un prodotto
	// sbagliato, e va segnalato all'utente invece che scritto.
	const identityMismatch = ['gtin', 'sku'].some((key) => {
		const found = identity?.[key];
		const known = knownIdentity?.[key];
		return found && known && String(found).trim() !== String(known).trim();
	});
	checks.identity = !identityMismatch;
	if (identityMismatch) reasons.push(REJECT.IDENTITY_CHANGED);

	// 4. Coerenza di valuta. Un cambio senza cambio di dominio e' il sintomo
	// classico di un geo-redirect o di un blocco preso per un altro.
	const currencyChanged = Boolean(currency && knownCurrency && currency !== knownCurrency);
	checks.currency = !currencyChanged;
	if (currencyChanged) reasons.push(REJECT.CURRENCY_CHANGED);

	// 5. Variazione rispetto allo storico.
	const recentPrices = (history || [])
		.filter((entry) => entry && typeof entry.price === 'number')
		.slice(0, LIMITS.HISTORY_WINDOW)
		.map((entry) => entry.price);
	const reference = median(recentPrices);

	let needsConfirmation = false;
	if (reference !== null && reference > 0) {
		const relative = Math.abs(price - reference) / reference;
		checks.deltaRatio = Math.round(relative * 1000) / 1000;

		if (relative > LIMITS.DELTA_RATIO) {
			// Non un rifiuto: una richiesta di prova. Passa subito se la
			// confidenza e' molto alta o se un secondo fetch ha confermato.
			if (confidence >= LIMITS.DELTA_CONFIDENCE_OVERRIDE || confirmed) {
				checks.deltaAccepted = true;
			} else {
				needsConfirmation = true;
				reasons.push(REJECT.DELTA_IMPLAUSIBLE);
			}
		}
	}

	// 6. Anti-flapping.
	const flapping = confidence < LIMITS.FLAP_MAX_CONFIDENCE
		&& isFlapping(history, price);
	checks.stable = !flapping;
	if (flapping) reasons.push(REJECT.FLAPPING);

	// Esito.
	const hardFailure = !checks.range || !checks.confidence
		|| identityMismatch || currencyChanged || flapping;

	if (hardFailure) {
		return { outcome: OUTCOME.QUARANTINED, accepted: false, reasons, checks };
	}
	if (needsConfirmation) {
		return { outcome: OUTCOME.NEEDS_CONFIRMATION, accepted: false, reasons, checks };
	}

	return { outcome: OUTCOME.ACCEPTED, accepted: true, reasons: [], checks };
}

/**
 * Stato di salute del tracking dopo un'esecuzione.
 *
 * @param {object} params
 * @param {string} params.outcome - esito di validatePrice
 * @param {number} [params.consecutiveFailures=0] - conteggio precedente
 * @param {boolean} [params.identityChanged=false]
 * @param {boolean} [params.blocked=false]
 * @returns {{health: string, consecutiveFailures: number}}
 */
function nextTrackingHealth({ outcome, consecutiveFailures = 0, identityChanged = false, blocked = false }) {
	if (blocked) return { health: 'blocked', consecutiveFailures };
	if (identityChanged) return { health: 'degraded', consecutiveFailures };

	if (outcome === OUTCOME.ACCEPTED) {
		return { health: 'healthy', consecutiveFailures: 0 };
	}

	const failures = consecutiveFailures + 1;
	// Un fallimento isolato non e' una rottura: puo' essere una pagina lenta o
	// un intoppo di rete. Tre di fila non lo sono piu'.
	return { health: failures >= 3 ? 'broken' : 'degraded', consecutiveFailures: failures };
}

module.exports = {
	validatePrice,
	nextTrackingHealth,
	isFlapping,
	median,
	THRESHOLDS,
	LIMITS,
	OUTCOME,
	REJECT,
};
