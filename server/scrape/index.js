/**
 * Facciata pubblica del motore di scrape.
 *
 * Da qui in poi il percorso primario e' la pipeline generica: nessuno store ha
 * codice dedicato, le specificita' vivono come ricette a database.
 *
 * Il browser resta necessario finche' non arriva il fetch HTTP del tier 0: la
 * differenza rispetto a prima e' che il browser serve solo a OTTENERE l'HTML,
 * mentre l'interpretazione e' interamente della pipeline.
 */

const { createDocument } = require('./document');
const { runPipeline } = require('./pipeline');
const { detectPlatform } = require('./extract/platforms');
const { describeOffer } = require('./normalize/offer');
const { toLegacyBoolean } = require('./normalize/availability');

/**
 * Interpreta l'HTML di una pagina prodotto.
 *
 * @param {string} html
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {object|null} [options.recipe] - ricetta attiva, per il fast path
 * @param {number|null} [options.lastKnownPrice]
 * @param {boolean} [options.antiBotDetected]
 * @returns {object} risultato normalizzato, con provenienza e confidenza
 */
function interpret(html, options = {}) {
	const { url } = options;
	const doc = createDocument(html, { url });

	const pipeline = runPipeline(doc, options);
	const { platform } = detectPlatform(doc);
	const offer = describeOffer(pipeline.result, url);

	return {
		// Campi piatti, nella forma che il resto dell'applicazione gia' usa.
		title: pipeline.result.title ?? null,
		image: pipeline.result.image ?? null,
		description: pipeline.result.description ?? null,
		price: pipeline.result.price ?? null,
		priceValue: pipeline.result.price ?? null,
		currency: pipeline.result.currency ?? null,
		availability: pipeline.result.availability ?? 'unknown',
		available: toLegacyBoolean(pipeline.result.availability ?? 'unknown'),
		brand: pipeline.result.brand ?? null,
		sku: pipeline.result.sku ?? null,
		gtin: pipeline.result.gtin ?? null,
		store: offerStore(url),
		details: {
			seller: pipeline.result.seller ?? null,
			condition: pipeline.result.condition ?? null,
		},

		// Diagnostica: e' cio' che finira' in scrape_runs.
		canonicalUrl: pipeline.canonicalUrl,
		platform,
		offer,
		confidence: pipeline.confidence,
		signals: pipeline.signals,
		fields: pipeline.fields,
		candidates: pipeline.candidates,
		extractorsRan: pipeline.extractorsRan,
		usedFastPath: pipeline.usedFastPath,
		recipeId: pipeline.recipeId,
		recipeVersion: pipeline.recipeVersion,
		durationMs: pipeline.durationMs,
	};
}

/** Slug dello store, ricavato dal dominio. Sostituisce la mappa cablata. */
function offerStore(url) {
	if (!url) return null;
	try {
		const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
		return hostname.split('.')[0] || null;
	} catch (e) {
		return null;
	}
}

module.exports = { interpret, offerStore };
