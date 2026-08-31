/**
 * Genera un selettore CSS stabile per un elemento.
 *
 * Serve al learner: quando a vincere e' l'estrattore DOM, la ricetta deve
 * poter riapplicare la stessa scelta senza rifare tutta l'euristica. Un
 * percorso leggibile ("div.price") non basta - deve essere ESEGUIBILE, ed e'
 * la differenza fra una ricetta che funziona davvero e una che descrive.
 *
 * "Stabile" significa che si preferiscono gli attributi che sopravvivono a un
 * rilascio dello store (id, data-test, itemprop) e si scartano le classi
 * generate a build time, che cambiano a ogni deploy.
 */

/** Classi generate da bundler e CSS-in-JS: cambiano a ogni build. */
const GENERATED_CLASS_PATTERNS = [
	/^css-[0-9a-z]{4,}$/i,       // emotion
	/^jsx-[0-9]{4,}$/i,          // styled-jsx
	/^sc-[0-9a-z]{5,}$/i,        // styled-components
	/^ng-tns-/,                  // Angular
	/^svelte-[0-9a-z]{5,}$/i,
	/^[0-9a-f]{6,}$/i,           // hash nudo
];

/**
 * Un frammento sembra un hash?
 *
 * Serve a distinguere il suffisso generato di CSS Modules
 * ("styles_price__a1b2c") da una classe BEM scritta a mano ("price__value"),
 * che invece e' perfettamente stabile e va conservata. Il discrimine e' la
 * mescolanza di lettere e cifre: gli hash ce l'hanno, le parole no.
 */
function looksLikeHash(fragment) {
	if (!fragment || fragment.length < 4) return false;
	return /\d/.test(fragment) && /[a-z]/i.test(fragment);
}

/** Attributi che identificano un elemento meglio di qualunque classe. */
const STABLE_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'itemprop', 'data-automation-id'];

function isGeneratedClass(className) {
	if (GENERATED_CLASS_PATTERNS.some((pattern) => pattern.test(className))) return true;

	// CSS Modules: <file>_<classe>__<hash> oppure <classe>_<hash>
	const moduleMatch = /^[A-Za-z][\w-]*?_{1,2}([A-Za-z0-9]+)$/.exec(className);
	return moduleMatch !== null && looksLikeHash(moduleMatch[1]);
}

/** Un id che sembra generato non identifica nulla al prossimo caricamento. */
function isUsableId(id) {
	if (!id || /\s/.test(id)) return false;
	if (/^\d/.test(id)) return false;          // un id numerico non e' un selettore valido
	if (/[0-9a-f]{8,}/i.test(id)) return false; // uuid o hash
	return true;
}

/** Sfugge i caratteri speciali in un valore di attributo. */
function escapeValue(value) {
	return String(value).replace(/(["\\])/g, '\\$1');
}

/**
 * Descrittore di un singolo livello: il modo piu' specifico e stabile di
 * nominare questo elemento fra i suoi pari.
 */
function describeLevel($, element) {
	const node = $(element);
	const tag = (element.tagName || element.name || '').toLowerCase();
	const attribs = element.attribs || {};

	if (isUsableId(attribs.id)) return `#${attribs.id}`;

	for (const attribute of STABLE_ATTRIBUTES) {
		if (attribs[attribute]) {
			return `${tag}[${attribute}="${escapeValue(attribs[attribute])}"]`;
		}
	}

	const classes = (attribs.class || '')
		.split(/\s+/)
		.filter(Boolean)
		.filter((className) => !isGeneratedClass(className));

	if (classes.length > 0) {
		// Al massimo due classi: una in piu' aumenta la specificita' senza
		// aggiungere stabilita', e basta che ne cambi una perche' il selettore
		// smetta di funzionare.
		return `${tag}.${classes.slice(0, 2).map((c) => CSS_escape(c)).join('.')}`;
	}

	// Nessun appiglio: posizione fra i fratelli dello stesso tag.
	const siblings = node.parent().children(tag).toArray();
	if (siblings.length > 1) {
		const index = siblings.indexOf(element) + 1;
		return `${tag}:nth-of-type(${index})`;
	}

	return tag;
}

/** Sfugge i caratteri non validi in un nome di classe CSS. */
function CSS_escape(value) {
	return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/**
 * @param {object} $ - istanza cheerio
 * @param {object} element
 * @param {object} [options]
 * @param {number} [options.maxLevels=6]
 * @returns {string|null} un selettore che seleziona esattamente questo
 *   elemento, oppure null se non e' stato possibile renderlo univoco
 */
function cssPath($, element, options = {}) {
	const { maxLevels = 6 } = options;
	if (!element || !(element.tagName || element.name)) return null;

	const parts = [];
	let current = element;

	for (let level = 0; level < maxLevels && current && (current.tagName || current.name); level++) {
		const tag = (current.tagName || current.name).toLowerCase();
		if (tag === 'html') break;

		parts.unshift(describeLevel($, current));
		const selector = parts.join(' > ');

		// Ci si ferma appena il selettore e' univoco: aggiungere altri livelli
		// lo renderebbe solo piu' fragile.
		let matched;
		try {
			matched = $(selector);
		} catch (e) {
			return null; // selettore non valido: meglio nessuna ricetta che una rotta
		}

		if (matched.length === 1 && matched[0] === element) return selector;

		if (tag === 'body') break;
		current = current.parent || current.parentNode;
	}

	const selector = parts.join(' > ');
	if (!selector) return null;

	try {
		const matched = $(selector);
		// Non univoco: si accetta solo se il nostro elemento e' il primo, cosi'
		// riapplicarlo da comunque il risultato giusto.
		return matched.length > 0 && matched[0] === element ? selector : null;
	} catch (e) {
		return null;
	}
}

module.exports = { cssPath, isGeneratedClass, isUsableId, looksLikeHash, describeLevel };
