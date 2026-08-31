/**
 * Telemetria del motore.
 *
 * Le metriche non sono un ornamento: senza, l'unico modo per accorgersi che
 * uno store ha cambiato pagina e' che un utente se ne lamenti. Con le ricette
 * a database il motore si ripara da solo nel caso normale, ma i casi in cui
 * NON ci riesce devono essere visibili.
 *
 * L'uscita e' una riga JSON con un prefisso stabile, estraibile dai log di
 * Netlify senza altra infrastruttura.
 */

const PREFIX = '[Metric]';

/** Soglie oltre le quali un valore merita attenzione. */
const ALERT = Object.freeze({
	DOMAIN_SUCCESS_RATE: 0.5,     // sotto il 50% su un dominio
	MIN_RUNS_FOR_ALERT: 10,       // ...ma solo con abbastanza esecuzioni
	QUARANTINE_RATIO: 0.05,       // oltre il 5% delle osservazioni respinte
	BROKEN_HOURS: 72,             // un prodotto rotto da piu' di tre giorni
});

/**
 * Emette una metrica.
 * @param {string} name
 * @param {object} fields
 */
function emit(name, fields = {}) {
	const line = JSON.stringify({ metric: name, at: new Date().toISOString(), ...fields });
	console.log(`${PREFIX} ${line}`);
}

/** Esito di un singolo controllo. */
function recordCheck({ domain, accepted, confidence, source, usedFastPath, durationMs, reasons = [] }) {
	emit('scrape.check', {
		domain,
		accepted,
		confidence,
		source,
		fastPath: Boolean(usedFastPath),
		durationMs,
		reasons: reasons.length > 0 ? reasons : undefined,
	});
}

/** Cambio di stato di una ricetta. */
function recordRecipeTransition({ domain, from, to, version }) {
	emit('recipe.transition', { domain, from, to, version });
	if (to === 'quarantined') {
		emit('alert.recipe_quarantined', { domain, version });
	}
}

/**
 * Aggrega gli esiti e segnala cio' che merita attenzione.
 *
 * Funzione pura: riceve le righe e restituisce il riepilogo, quindi e'
 * verificabile senza database e senza log.
 *
 * @param {Array<object>} checks - esiti di controllo
 * @returns {{total: number, accepted: number, successRate: number|null, byDomain: object, alerts: Array<object>}}
 */
function summarize(checks) {
	const list = checks || [];
	const byDomain = {};

	for (const check of list) {
		if (!check || !check.domain) continue;
		if (!byDomain[check.domain]) {
			byDomain[check.domain] = { total: 0, accepted: 0, fastPath: 0, confidenceSum: 0 };
		}
		const bucket = byDomain[check.domain];
		bucket.total++;
		if (check.accepted) bucket.accepted++;
		if (check.usedFastPath) bucket.fastPath++;
		if (typeof check.confidence === 'number') bucket.confidenceSum += check.confidence;
	}

	const alerts = [];
	for (const [domain, bucket] of Object.entries(byDomain)) {
		bucket.successRate = bucket.total > 0 ? bucket.accepted / bucket.total : null;
		bucket.avgConfidence = bucket.total > 0
			? Math.round((bucket.confidenceSum / bucket.total) * 1000) / 1000
			: null;
		delete bucket.confidenceSum;

		// Si segnala solo con abbastanza esecuzioni: due fallimenti su tre
		// controlli non dicono nulla, cinquanta su cento si'.
		if (bucket.total >= ALERT.MIN_RUNS_FOR_ALERT && bucket.successRate < ALERT.DOMAIN_SUCCESS_RATE) {
			alerts.push({
				type: 'dominio_in_difficolta',
				domain,
				successRate: Math.round(bucket.successRate * 100) / 100,
				runs: bucket.total,
			});
		}
	}

	const total = list.length;
	const accepted = list.filter((check) => check?.accepted).length;
	const quarantineRatio = total > 0 ? (total - accepted) / total : 0;

	if (total >= ALERT.MIN_RUNS_FOR_ALERT && quarantineRatio > ALERT.QUARANTINE_RATIO) {
		alerts.push({
			type: 'troppe_quarantene',
			ratio: Math.round(quarantineRatio * 1000) / 1000,
			soglia: ALERT.QUARANTINE_RATIO,
		});
	}

	return {
		total,
		accepted,
		successRate: total > 0 ? Math.round((accepted / total) * 1000) / 1000 : null,
		fastPathRatio: total > 0
			? Math.round((list.filter((c) => c?.usedFastPath).length / total) * 1000) / 1000
			: null,
		byDomain,
		alerts,
	};
}

module.exports = { emit, recordCheck, recordRecipeTransition, summarize, ALERT, PREFIX };
