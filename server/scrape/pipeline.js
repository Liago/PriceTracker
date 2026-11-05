/** Extract current-page evidence, with recipes used only as additional candidates. */

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
 * @param {object|null} [options.recipe] - previous extraction strategy, revalidated on this document
 * @returns {object} risultato con campi, confidenza, candidati e diagnostica
 */
function runPipeline(input, options = {}) {
	const {
		url,
		lastKnownPrice = null,
		antiBotDetected = false,
		recipe = null,
	} = options;

	const doc = typeof input === 'string' ? createDocument(input, { url }) : input;
	const startedAt = Date.now();

	const candidates = [];
	const extractorsRan = [];

	// Recipes remain evidence; always compare against the current document.
	if (recipe) {
		const produced = applyRecipe(recipe, doc);
		candidates.push(...produced);
		extractorsRan.push({ name: 'recipe', candidates: produced.length, durationMs: 0, error: null });
	}
	const retailer = require('./extract/retailers').extract(doc);
	if (retailer !== null) {
		const reconciled = reconcile(retailer, { antiBotDetected });
		return { url: doc.url, canonicalUrl: doc.canonicalUrl(), ...reconciled,
			candidates: retailer, extractorsRan: [{ name: 'retailer', candidates: retailer.length, durationMs: Date.now() - startedAt }],
			usedFastPath: false, recipeId: null, recipeVersion: null, durationMs: Date.now() - startedAt };
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
