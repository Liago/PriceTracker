/**
 * Forma e validazione di una ricetta.
 *
 * Una ricetta e' la configurazione che permette di rileggere una pagina senza
 * rifare la scoperta. Validarla non e' pedanteria: una ricetta malformata a
 * database verrebbe applicata a ogni check di quel dominio, e produrrebbe
 * silenziosamente prezzi sbagliati o nessun prezzo.
 */

const STRATEGIES = Object.freeze(['jsonld', 'appstate', 'microdata', 'meta', 'css']);
const TRANSPORTS = Object.freeze(['http', 'browser', 'browser_interactive']);
const STATUSES = Object.freeze(['active', 'candidate', 'deprecated', 'quarantined']);
const ORIGINS = Object.freeze(['learned', 'manual', 'seeded']);

/** Campi che una ricetta puo' descrivere. */
const KNOWN_FIELDS = Object.freeze([
	'price', 'currency', 'availability', 'title', 'image', 'description',
	'brand', 'sku', 'mpn', 'gtin', 'seller', 'condition',
]);

/**
 * Valida il descrittore di un singolo campo.
 * @returns {Array<string>} elenco degli errori, vuoto se valido
 */
function validateFieldSpec(field, spec) {
	const errors = [];
	const where = `fields.${field}`;

	if (!spec || typeof spec !== 'object') {
		return [`${where}: deve essere un oggetto`];
	}

	if (!STRATEGIES.includes(spec.strategy)) {
		errors.push(`${where}.strategy: "${spec.strategy}" non e' fra ${STRATEGIES.join(', ')}`);
	}

	if (spec.strategy === 'css') {
		if (typeof spec.selector !== 'string' || spec.selector.trim() === '') {
			errors.push(`${where}.selector: obbligatorio per la strategia css`);
		}
		if (spec.attr !== null && spec.attr !== undefined && typeof spec.attr !== 'string') {
			errors.push(`${where}.attr: deve essere una stringa o null`);
		}
	}

	if (spec.strategy === 'meta' && (typeof spec.key !== 'string' || spec.key.trim() === '')) {
		errors.push(`${where}.key: obbligatorio per la strategia meta`);
	}

	if (spec.fallbacks !== undefined) {
		if (!Array.isArray(spec.fallbacks)) {
			errors.push(`${where}.fallbacks: deve essere un array`);
		} else {
			spec.fallbacks.forEach((fallback, index) => {
				errors.push(...validateFieldSpec(`${field}.fallbacks[${index}]`, fallback));
			});
		}
	}

	return errors;
}

/**
 * @param {object} recipe
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateRecipe(recipe) {
	const errors = [];

	if (!recipe || typeof recipe !== 'object') {
		return { valid: false, errors: ['la ricetta deve essere un oggetto'] };
	}

	if (typeof recipe.domain !== 'string' || recipe.domain.trim() === '') {
		errors.push('domain: obbligatorio');
	}

	if (recipe.transport !== undefined && !TRANSPORTS.includes(recipe.transport)) {
		errors.push(`transport: "${recipe.transport}" non e' fra ${TRANSPORTS.join(', ')}`);
	}
	if (recipe.status !== undefined && !STATUSES.includes(recipe.status)) {
		errors.push(`status: "${recipe.status}" non e' fra ${STATUSES.join(', ')}`);
	}
	if (recipe.origin !== undefined && !ORIGINS.includes(recipe.origin)) {
		errors.push(`origin: "${recipe.origin}" non e' fra ${ORIGINS.join(', ')}`);
	}

	if (!recipe.fields || typeof recipe.fields !== 'object' || Array.isArray(recipe.fields)) {
		errors.push('fields: obbligatorio, deve essere un oggetto');
		return { valid: false, errors };
	}

	// Una ricetta che non sa leggere il prezzo non serve a nulla: e' l'unico
	// campo per cui esiste tutto il resto del sistema.
	if (!recipe.fields.price) {
		errors.push('fields.price: obbligatorio, una ricetta senza prezzo e\' inutile');
	}

	for (const [field, spec] of Object.entries(recipe.fields)) {
		errors.push(...validateFieldSpec(field, spec));
	}

	return { valid: errors.length === 0, errors };
}

module.exports = { validateRecipe, validateFieldSpec, STRATEGIES, TRANSPORTS, STATUSES, ORIGINS, KNOWN_FIELDS };
