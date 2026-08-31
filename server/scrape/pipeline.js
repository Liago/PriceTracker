/**
 * La pipeline di estrazione generica.
 *
 * Esegue gli estrattori sul Document, raccoglie i candidati, li riconcilia e
 * restituisce un risultato con confidenza e provenienza. Non conosce nessuno
 * store: le specificita' vivranno come ricette a database (fase 3).
 */

const { createDocument } = require('./document');
const { reconcile } = require('./score/reconcile');

const jsonLd = require('./extract/jsonLd');
const microdata = require('./extract/microdata');
const metaTags = require('./extract/metaTags');
const appState = require('./extract/appState');
const domHeuristics = require('./extract/domHeuristics');

/**
 * Ordine di esecuzione. In discovery girano tutti: non e' una cascata con
 * uscita anticipata, perche' il valore sta proprio nel confronto fra sorgenti
 * indipendenti - e' quello che alza la confidenza.
 */
const EXTRACTORS = [jsonLd, appState, microdata, metaTags, domHeuristics];

/**
 * @param {string|import('./document').ScrapeDocument} input - HTML o Document
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {number|null} [options.lastKnownPrice] - premia la coerenza storica
 * @param {boolean} [options.antiBotDetected=false]
 * @returns {object} risultato con campi, confidenza, candidati e diagnostica
 */
function runPipeline(input, options = {}) {
	const { url, lastKnownPrice = null, antiBotDetected = false } = options;

	const doc = typeof input === 'string' ? createDocument(input, { url }) : input;
	const startedAt = Date.now();

	const candidates = [];
	const extractorsRan = [];

	for (const extractor of EXTRACTORS) {
		const extractorStart = Date.now();
		let produced = [];
		let error = null;

		try {
			produced = extractor.extract(doc, { lastKnownPrice }) || [];
		} catch (e) {
			// Un estrattore che fallisce non deve fermare gli altri: e' il
			// motivo per cui sono indipendenti.
			error = e.message;
		}

		extractorsRan.push({
			name: extractor.name,
			candidates: produced.length,
			durationMs: Date.now() - extractorStart,
			error,
		});

		candidates.push(...produced);
	}

	const reconciled = reconcile(candidates, { antiBotDetected });

	return {
		url: doc.url,
		canonicalUrl: doc.canonicalUrl(),
		result: reconciled.result,
		fields: reconciled.fields,
		confidence: reconciled.confidence,
		signals: reconciled.signals,
		candidates,
		extractorsRan,
		durationMs: Date.now() - startedAt,
	};
}

module.exports = { runPipeline, EXTRACTORS };
