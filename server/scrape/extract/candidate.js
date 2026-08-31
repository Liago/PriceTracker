/**
 * Candidato: cio' che un estrattore produce.
 *
 * Il principio del refactor e' che nessun estrattore restituisce un risultato,
 * ma una proposta con provenienza, evidenza e peso. La riconciliazione le
 * confronta e decide; la validazione decide se fidarsi. Senza provenienza non
 * si puo' ne' calcolare una confidenza ne' spiegare a posteriori perche' a
 * database e' finito un certo prezzo.
 */

/** Pesi base per sorgente, dal design doc (sezione 7). */
const SOURCE_WEIGHTS = Object.freeze({
	recipe: 0.95,
	platform: 0.93,
	jsonld: 0.90,
	appstate: 0.85,
	microdata: 0.80,
	meta: 0.65,
	dom: 0.55,
	url: 0.60,
	title: 0.40,
});

/**
 * @param {object} spec
 * @param {string} spec.field - price | currency | title | image | availability | ...
 * @param {*} spec.value - valore normalizzato
 * @param {*} [spec.raw] - valore com'era nella pagina, per la diagnostica
 * @param {string} spec.source - chiave di SOURCE_WEIGHTS
 * @param {string} [spec.path] - percorso o selettore che l'ha prodotto
 * @param {string} [spec.evidence] - frammento leggibile da mostrare a un umano
 * @param {number} [spec.weight] - sovrascrive il peso base della sorgente
 * @param {object} [spec.meta] - segnali aggiuntivi per lo scoring
 * @param {object} [spec.locator] - descrittore ESEGUIBILE di come ritrovare
 *   questo valore: {strategy, ...}. E' cio' che il learner salva nella ricetta
 *   e che l'applier riesegue. Il campo `path` accanto e' solo leggibile
 *   dall'uomo, e non basta per rifare il lavoro.
 * @returns {object}
 */
function candidate(spec) {
	const { field, value, raw, source, path, evidence, weight, meta, locator } = spec;
	return {
		field,
		value,
		raw: raw !== undefined ? raw : value,
		source,
		path: path || null,
		evidence: evidence || null,
		weight: typeof weight === 'number' ? weight : (SOURCE_WEIGHTS[source] ?? 0.5),
		meta: meta || {},
		locator: locator || null,
	};
}

/**
 * Scarta i candidati senza valore utile.
 * @param {Array} candidates
 * @returns {Array}
 */
function compact(candidates) {
	return candidates.filter((c) => c && c.value !== null && c.value !== undefined && c.value !== '');
}

module.exports = { candidate, compact, SOURCE_WEIGHTS };
