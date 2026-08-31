/**
 * Shadow mode: la pipeline generica gira accanto agli scraper attuali senza
 * scrivere nulla, e ogni esecuzione confronta i due risultati.
 *
 * E' il criterio di uscita della fase 2 del design doc: prima di sostituire i
 * tredici scraper dedicati bisogna dimostrare, su traffico reale e non su
 * fixture, che la pipeline concorda con loro; e che dove non concorda ha
 * ragione lei. Un cutover senza questa evidenza sarebbe una scommessa.
 *
 * Vincolo assoluto: nulla di quanto sta qui puo' influenzare il risultato
 * restituito. Il confronto e' osservazione, non decisione.
 */

const { parsePrice } = require('./normalize/price');

/** Scarto relativo oltre il quale due prezzi sono considerati diversi. */
const PRICE_TOLERANCE = 0.005; // mezzo punto percentuale

const AGREEMENT = Object.freeze({
	MATCH: 'match',                 // stesso prezzo
	MISMATCH: 'mismatch',           // prezzi diversi
	LEGACY_ONLY: 'legacy_only',     // solo lo scraper attuale ha trovato un prezzo
	PIPELINE_ONLY: 'pipeline_only', // solo la pipeline
	BOTH_FAILED: 'both_failed',
});

/**
 * Confronta il risultato dello scraper attuale con quello della pipeline.
 *
 * @param {object} params
 * @param {object} params.legacy - uscita grezza di uno scraper dedicato
 * @param {object} params.pipeline - uscita di runPipeline
 * @param {string} [params.url]
 * @returns {object} record di confronto
 */
function compareResults({ legacy, pipeline, url }) {
	const legacyPrice = parsePrice(legacy?.price);
	const pipelinePrice = pipeline?.result?.price ?? null;

	let agreement;
	let deltaPct = null;

	if (legacyPrice === null && pipelinePrice === null) {
		agreement = AGREEMENT.BOTH_FAILED;
	} else if (legacyPrice === null) {
		agreement = AGREEMENT.PIPELINE_ONLY;
	} else if (pipelinePrice === null) {
		agreement = AGREEMENT.LEGACY_ONLY;
	} else {
		const relative = Math.abs(pipelinePrice - legacyPrice) / Math.max(legacyPrice, 0.01);
		deltaPct = Math.round(relative * 10000) / 100;
		agreement = relative <= PRICE_TOLERANCE ? AGREEMENT.MATCH : AGREEMENT.MISMATCH;
	}

	// Differenze sui campi non numerici: utili per capire se la pipeline
	// perderebbe qualcosa che oggi il client mostra.
	const fieldDiffs = {};
	const compareField = (name, legacyValue, pipelineValue) => {
		const l = legacyValue === undefined || legacyValue === '' ? null : legacyValue;
		const p = pipelineValue === undefined || pipelineValue === '' ? null : pipelineValue;
		if (l === null && p === null) return;
		if (l !== p) fieldDiffs[name] = { legacy: l, pipeline: p };
	};

	compareField('title', legacy?.title, pipeline?.result?.title);
	compareField('image', legacy?.image, pipeline?.result?.image);
	compareField('currency', legacy?.currency, pipeline?.result?.currency);

	return {
		url: url || pipeline?.url || null,
		agreement,
		legacyPrice,
		pipelinePrice,
		deltaPct,
		legacyStrategy: legacy?.debug?.strategy || null,
		pipelineSource: pipeline?.fields?.price?.source || null,
		pipelineConfidence: pipeline?.confidence ?? null,
		pipelineSignals: pipeline?.signals || [],
		fieldDiffs,
		fieldDiffCount: Object.keys(fieldDiffs).length,
	};
}

/**
 * Aggrega piu' confronti. Serve a rispondere alla domanda che decide la fase:
 * la pipeline concorda con gli scraper attuali in almeno il 95% dei casi?
 *
 * @param {Array<object>} comparisons
 * @returns {object}
 */
function summarize(comparisons) {
	const list = comparisons || [];
	const counts = {
		[AGREEMENT.MATCH]: 0,
		[AGREEMENT.MISMATCH]: 0,
		[AGREEMENT.LEGACY_ONLY]: 0,
		[AGREEMENT.PIPELINE_ONLY]: 0,
		[AGREEMENT.BOTH_FAILED]: 0,
	};

	for (const comparison of list) {
		if (comparison && counts[comparison.agreement] !== undefined) counts[comparison.agreement]++;
	}

	// Il denominatore sono i casi in cui almeno uno dei due ha prodotto un
	// prezzo: se falliscono entrambi non c'e' accordo da misurare.
	const comparable = list.length - counts[AGREEMENT.BOTH_FAILED];
	const agreementRate = comparable > 0
		? Math.round((counts[AGREEMENT.MATCH] / comparable) * 10000) / 100
		: null;

	const confidences = list
		.map((c) => c && c.pipelineConfidence)
		.filter((value) => typeof value === 'number')
		.sort((a, b) => a - b);
	const medianConfidence = confidences.length > 0
		? confidences[Math.floor(confidences.length / 2)]
		: null;

	return {
		total: list.length,
		comparable,
		counts,
		agreementRate,
		medianConfidence,
		// Casi da guardare a mano: e' li' che si stabilisce chi ha ragione.
		toReview: list.filter((c) => c && (
			c.agreement === AGREEMENT.MISMATCH || c.agreement === AGREEMENT.LEGACY_ONLY
		)),
	};
}

/**
 * Scrive il confronto nei log con un prefisso stabile, cosi' che sia
 * estraibile dai log di produzione senza ancora avere la tabella scrape_runs
 * (che arriva in fase 4).
 */
function logComparison(comparison) {
	if (!comparison) return;
	const interesting = comparison.agreement !== AGREEMENT.MATCH;
	const line = `[Shadow] ${JSON.stringify(comparison)}`;
	if (interesting) console.warn(line);
	else console.log(line);
}

module.exports = { compareResults, summarize, logComparison, AGREEMENT, PRICE_TOLERANCE };
