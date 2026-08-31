/**
 * Deriva una ricetta dal risultato di una scoperta riuscita.
 *
 * E' il passaggio che chiude il ciclo del refactor: un parse riuscito non
 * produce solo dati, produce la configurazione che lo ha reso possibile. Da
 * quel momento il dominio ha una ricetta e non serve piu' rifare la scoperta.
 *
 * Il learner e' volutamente conservativo. Salva solo cio' che ha una
 * provenienza eseguibile e una confidenza sufficiente: una ricetta che
 * descrive senza saper rifare il lavoro sarebbe peggio di nessuna ricetta,
 * perche' verrebbe applicata comunque a ogni check.
 */

const { validateRecipe } = require('./schema');
const { KNOWN_FIELDS } = require('./schema');

/** Sotto questa confidenza non si impara nulla: si rischierebbe di consolidare un errore. */
const MIN_CONFIDENCE_TO_LEARN = 0.6;

/**
 * Estrae il dominio da un URL, senza il www.
 * @returns {string|null}
 */
function domainOf(url) {
	if (!url) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch (e) {
		return null;
	}
}

/**
 * @param {object} pipelineResult - uscita di runPipeline
 * @param {object} [options]
 * @param {string} [options.url] - se il risultato non porta gia' l'URL
 * @param {string} [options.origin='learned']
 * @param {number} [options.minConfidence]
 * @returns {{recipe: object|null, reason: string}}
 */
function learnRecipe(pipelineResult, options = {}) {
	const {
		url,
		origin = 'learned',
		minConfidence = MIN_CONFIDENCE_TO_LEARN,
	} = options;

	if (!pipelineResult || !pipelineResult.fields) {
		return { recipe: null, reason: 'nessun risultato da cui imparare' };
	}

	if (pipelineResult.confidence < minConfidence) {
		return {
			recipe: null,
			reason: `confidenza ${pipelineResult.confidence} sotto la soglia ${minConfidence}`,
		};
	}

	const domain = domainOf(url || pipelineResult.url);
	if (!domain) {
		return { recipe: null, reason: 'dominio non determinabile' };
	}

	const price = pipelineResult.fields.price;
	if (!price) {
		return { recipe: null, reason: 'nessun prezzo estratto' };
	}
	if (!price.locator || !price.locator.strategy) {
		// Senza localizzatore eseguibile la ricetta non saprebbe rifare il
		// lavoro: meglio non salvarla che salvarne una inerte.
		return { recipe: null, reason: 'il candidato prezzo non porta un localizzatore eseguibile' };
	}

	const fields = {};
	for (const field of KNOWN_FIELDS) {
		const resolved = pipelineResult.fields[field];
		if (!resolved || !resolved.locator || !resolved.locator.strategy) continue;
		fields[field] = { ...resolved.locator, confidence: resolved.weight };
	}

	// Le sorgenti che hanno confermato il prezzo diventano fallback: se la
	// strategia principale smette di funzionare dopo un redesign, la ricetta
	// ha gia' un piano B invece di dover tornare in scoperta completa.
	const fallbacks = (pipelineResult.candidates || [])
		.filter((c) =>
			c.field === 'price'
			&& c.locator && c.locator.strategy
			&& c.locator.strategy !== price.locator.strategy
			&& typeof c.value === 'number'
			&& Math.abs(c.value - price.value) < 0.005
		)
		.map((c) => ({ ...c.locator }));

	if (fallbacks.length > 0) {
		fields.price.fallbacks = fallbacks;
	}

	const recipe = {
		domain,
		url_pattern: '*',
		scope: 'domain',
		status: 'candidate',
		origin,
		transport: 'http',
		fields,
		confidence: pipelineResult.confidence,
		learned_from: {
			url: url || pipelineResult.url || null,
			winningSource: price.source,
			signals: pipelineResult.signals || [],
		},
	};

	const validation = validateRecipe(recipe);
	if (!validation.valid) {
		return { recipe: null, reason: `ricetta non valida: ${validation.errors.join('; ')}` };
	}

	return { recipe, reason: 'ok' };
}

/**
 * Decide cosa fare di una ricetta candidate dopo un'esecuzione.
 *
 * Una nuova strategia non diventa subito quella ufficiale: serve una serie di
 * successi. E' la protezione contro l'apprendimento di un errore occasionale,
 * che verrebbe poi riapplicato a ogni check.
 *
 * @param {object} recipe - ricetta corrente, con i suoi contatori
 * @param {boolean} succeeded
 * @param {object} [options]
 * @param {number} [options.promoteAfter=3]
 * @param {number} [options.quarantineAfter=3]
 * @returns {{status: string, successCount: number, failureCount: number, consecutiveFailures: number, changed: boolean}}
 */
function nextRecipeState(recipe, succeeded, options = {}) {
	const { promoteAfter = 3, quarantineAfter = 3 } = options;

	const successCount = (recipe?.success_count ?? 0) + (succeeded ? 1 : 0);
	const failureCount = (recipe?.failure_count ?? 0) + (succeeded ? 0 : 1);
	const consecutiveFailures = succeeded ? 0 : (recipe?.consecutive_failures ?? 0) + 1;
	const current = recipe?.status ?? 'candidate';

	let status = current;

	if (!succeeded && consecutiveFailures >= quarantineAfter && current !== 'quarantined') {
		status = 'quarantined';
	} else if (succeeded && current === 'candidate' && successCount >= promoteAfter) {
		status = 'active';
	} else if (succeeded && current === 'quarantined') {
		// Torna in prova, non subito in produzione.
		status = 'candidate';
	}

	return {
		status,
		successCount,
		failureCount,
		consecutiveFailures,
		changed: status !== current,
	};
}

module.exports = { learnRecipe, nextRecipeState, domainOf, MIN_CONFIDENCE_TO_LEARN };
