/**
 * La pipeline di estrazione generica.
 *
 * Esegue gli estrattori sul Document, raccoglie i candidati, li riconcilia e
 * restituisce un risultato con confidenza e provenienza. Non conosce nessuno
 * store: le specificita' vivranno come ricette a database (fase 3).
 */

const { createDocument } = require('./document');
const { reconcile } = require('./score/reconcile');

const { applyRecipe } = require('./recipe/applier');

const platforms = require('./extract/platforms');
const jsonLd = require('./extract/jsonLd');
const microdata = require('./extract/microdata');
const metaTags = require('./extract/metaTags');
const appState = require('./extract/appState');
const domHeuristics = require('./extract/domHeuristics');

/**
 * Ordine di esecuzione. In discovery girano tutti: non e' una cascata con
 * uscita anticipata, perche' il valore sta proprio nel confronto fra sorgenti
 * indipendenti - e' quello che alza la confidenza.
 *
 * L'adapter di piattaforma viene per primo perche' ha il peso piu' alto fra le
 * sorgenti non apprese: quando riconosce Shopify o WooCommerce legge il
 * prodotto dall'oggetto che la piattaforma stessa espone, varianti comprese.
 */
const EXTRACTORS = [platforms, jsonLd, appState, microdata, metaTags, domHeuristics];

/**
 * @param {string|import('./document').ScrapeDocument} input - HTML o Document
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {number|null} [options.lastKnownPrice] - premia la coerenza storica
 * @param {boolean} [options.antiBotDetected=false]
 * @param {object|null} [options.recipe] - ricetta attiva per il dominio. Se
 *   presente si tenta il fast path: si riapplica direttamente la strategia che
 *   ha funzionato l'ultima volta, invece di rieseguire tutti gli estrattori.
 * @param {number} [options.fastPathThreshold=0.85] - confidenza sotto la quale
 *   il fast path non viene considerato sufficiente e si passa alla scoperta
 * @returns {object} risultato con campi, confidenza, candidati e diagnostica
 */
function runPipeline(input, options = {}) {
	const {
		url,
		lastKnownPrice = null,
		antiBotDetected = false,
		recipe = null,
		fastPathThreshold = 0.85,
	} = options;

	const doc = typeof input === 'string' ? createDocument(input, { url }) : input;
	const startedAt = Date.now();

	const candidates = [];
	const extractorsRan = [];

	// --- Fast path ---
	//
	// Se la ricetta produce un risultato affidabile ci si ferma qui: e' il
	// motivo per cui il refactor e' sostenibile in produzione. La scoperta
	// completa costa - cinque estrattori e una riconciliazione - mentre
	// riapplicare una strategia nota no.
	if (recipe) {
		const recipeStart = Date.now();
		let produced = [];
		let error = null;

		try {
			produced = applyRecipe(recipe, doc) || [];
		} catch (e) {
			error = e.message;
		}

		extractorsRan.push({
			name: 'recipe',
			candidates: produced.length,
			durationMs: Date.now() - recipeStart,
			error,
		});

		if (produced.length > 0) {
			const fastResult = reconcile(produced, { antiBotDetected });
			if (fastResult.confidence >= fastPathThreshold) {
				return {
					url: doc.url,
					canonicalUrl: doc.canonicalUrl(),
					result: fastResult.result,
					fields: fastResult.fields,
					confidence: fastResult.confidence,
					signals: [...fastResult.signals, 'fast-path'],
					candidates: produced,
					extractorsRan,
					usedFastPath: true,
					recipeId: recipe.id ?? null,
					recipeVersion: recipe.version ?? null,
					durationMs: Date.now() - startedAt,
				};
			}

			// Sotto soglia: i candidati della ricetta restano in gioco, ma si
			// esegue anche la scoperta. Se ne uscira' una strategia migliore,
			// il learner la registrera' come nuova versione.
			candidates.push(...produced);
		}
	}

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
		usedFastPath: false,
		recipeId: recipe?.id ?? null,
		recipeVersion: recipe?.version ?? null,
		durationMs: Date.now() - startedAt,
	};
}

module.exports = { runPipeline, EXTRACTORS };
