/**
 * E0 - Applica una ricetta salvata a database.
 *
 * E' il fast path: invece di eseguire tutti gli estrattori e confrontarne i
 * risultati, si riesegue direttamente la strategia che ha funzionato l'ultima
 * volta. E' cio' che rende il refactor sostenibile in produzione - la scoperta
 * completa costa, la riapplicazione no.
 */

const { candidate, compact } = require('../extract/candidate');
const { parsePrice } = require('../normalize/price');
const { normalizeCurrency } = require('../normalize/currency');
const { normalizeAvailability } = require('../normalize/availability');

const jsonLd = require('../extract/jsonLd');
const appState = require('../extract/appState');

/** Peso di un candidato prodotto da una ricetta, in funzione del suo storico. */
function recipeWeight(recipe) {
	const successes = recipe?.success_count ?? recipe?.successCount ?? 0;
	return successes >= 5 ? 0.95 : 0.80;
}

/** Porta un valore grezzo nel tipo giusto per il suo campo. */
function normalizeValue(field, raw, context) {
	if (raw === null || raw === undefined || raw === '') return null;

	switch (field) {
		case 'price':
			return parsePrice(raw);
		case 'currency':
			return normalizeCurrency(raw, { url: context.url, fallback: null });
		case 'availability':
			return normalizeAvailability(raw);
		default:
			return String(raw).replace(/\s+/g, ' ').trim() || null;
	}
}

/**
 * Esegue una singola strategia.
 * @returns {{value: *, raw: *}|null}
 */
function runStrategy(spec, doc, context) {
	switch (spec.strategy) {
		case 'css': {
			const node = doc.$(spec.selector).first();
			if (node.length === 0) return null;
			const raw = spec.attr ? node.attr(spec.attr) : node.text();
			return raw === undefined ? null : { raw };
		}
		case 'meta': {
			const raw = doc.meta(spec.key);
			return raw === null ? null : { raw };
		}
		case 'jsonld':
		case 'appstate':
		case 'microdata': {
			// Per le sorgenti strutturate la ricetta dice quale estrattore usare:
			// e' la configurazione utile, ed e' cio' che permette di saltare gli
			// altri. Il risultato viene messo in cache per non rieseguire lo
			// stesso estrattore una volta per campo.
			const cacheKey = spec.strategy;
			if (!context.cache.has(cacheKey)) {
				const extractor = { jsonld: jsonLd, appstate: appState, microdata: require('../extract/microdata') }[spec.strategy];
				let produced = [];
				try {
					produced = extractor.extract(doc) || [];
				} catch (e) {
					produced = [];
				}
				context.cache.set(cacheKey, produced);
			}
			const found = context.cache.get(cacheKey).find((c) => c.field === context.field);
			return found ? { raw: found.raw, value: found.value } : null;
		}
		default:
			return null;
	}
}

/**
 * @param {object} recipe - ricetta con la mappa fields
 * @param {import('../document').ScrapeDocument} doc
 * @param {object} [options]
 * @returns {Array} candidati, con sorgente 'recipe'
 */
function applyRecipe(recipe, doc, options = {}) {
	if (!recipe || !recipe.fields) return [];

	const weight = recipeWeight(recipe);
	const cache = new Map();
	const candidates = [];

	for (const [field, spec] of Object.entries(recipe.fields)) {
		if (!spec || typeof spec !== 'object') continue;

		const attempts = [spec, ...(Array.isArray(spec.fallbacks) ? spec.fallbacks : [])];

		for (let index = 0; index < attempts.length; index++) {
			const attempt = attempts[index];
			const context = { url: doc.url, field, cache };

			let outcome = null;
			try {
				outcome = runStrategy(attempt, doc, context);
			} catch (e) {
				outcome = null;
			}
			if (!outcome) continue;

			const value = outcome.value !== undefined && field !== 'price'
				? outcome.value
				: normalizeValue(field, outcome.raw, context);
			if (value === null) continue;

			candidates.push(candidate({
				field,
				value,
				raw: outcome.raw,
				source: 'recipe',
				weight,
				path: attempt.selector || attempt.key || attempt.strategy,
				evidence: typeof outcome.raw === 'string' ? outcome.raw.slice(0, 60) : String(outcome.raw),
				locator: attempt,
				meta: {
					recipeId: recipe.id ?? null,
					recipeVersion: recipe.version ?? null,
					viaFallback: index > 0,
					underlyingStrategy: attempt.strategy,
				},
			}));
			break; // il primo tentativo che produce un valore vince
		}
	}

	return compact(candidates);
}

module.exports = { applyRecipe, runStrategy, normalizeValue, recipeWeight };
