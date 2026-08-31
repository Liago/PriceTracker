/**
 * E6 - Euristiche sul DOM.
 *
 * Ultima risorsa della pipeline, e la piu' pericolosa: e' quella che salva gli
 * shop artigianali senza dati strutturati, ed e' anche la principale fonte di
 * falsi positivi. Un prezzo barrato, una rata mensile o il costo di spedizione
 * presi per il prezzo del prodotto sono il modo tipico in cui a database
 * finisce un numero sbagliato senza che nessuno se ne accorga.
 *
 * Per questo il lavoro e' fatto in due tempi: prima si SCARTANO i candidati
 * riconoscibilmente sbagliati, poi si assegna un punteggio a quelli rimasti.
 * Il peso base della sorgente resta basso (0,55): da solo non basta mai per un
 * salvataggio ad alta confidenza senza una conferma.
 *
 * Limite noto: senza browser non c'e' lo stile calcolato, quindi barrature e
 * invisibilita' si riconoscono da tag, classi e stile inline. Il raffinamento
 * con getComputedStyle e' un'aggiunta del tier 2.
 */

const { candidate, compact } = require('./candidate');
const { parsePriceDetailed } = require('../normalize/price');

const CURRENCY_MARKER = /[€$£¥₹₽]|\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN)\b/i;
const NUMBER = /\d[\d.,\s'’]*\d|\d/;

/** Testo troppo lungo per essere un prezzo: quasi certamente e' un paragrafo. */
const MAX_PRICE_TEXT_LENGTH = 60;

// --- Esclusioni ------------------------------------------------------------

/** Tag che indicano un prezzo barrato. */
const STRIKE_TAGS = new Set(['del', 's', 'strike']);

/** Frammenti di class/id che indicano un prezzo che non e' quello corrente. */
const STRIKE_CLASS_HINTS = [
	'strike', 'line-through', 'linethrough', 'old-price', 'oldprice', 'was-price',
	'wasprice', 'list-price', 'listprice', 'compare', 'regular-price', 'regularprice',
	'msrp', 'barrato', 'prezzo-precedente', 'crossed',
];

/** Frammenti di class/id che indicano un prezzo accessorio. */
const ACCESSORY_CLASS_HINTS = [
	'shipping', 'spedizione', 'installment', 'rata', 'monthly', 'mensile',
	'financing', 'finanziamento', 'saving', 'risparmi', 'discount', 'sconto',
	'tax', 'iva', 'unit-price', 'unitprice', 'price-per',
];

/** Frasi nel contesto che indicano un prezzo accessorio. */
const ACCESSORY_TEXT_HINTS = [
	'spedizione', 'shipping', 'consegna', 'iva esclusa', 'escl. iva', 'excl. vat',
	'al mese', '/mese', 'al mes', 'rata', 'rate da', 'finanziamento', 'in 3 rate',
	'a partire da', 'prezzo consigliato', 'invece di', 'risparmi', 'anziche',
	'anziché', 'listino', 'was ', 'instead of',
];

/** Unita' di misura che rivelano un prezzo unitario. */
const UNIT_HINTS = ['/kg', '/l', '/lt', '/g', '/ml', '/m2', '/mq', 'al kg', 'al litro', 'cad.', 'al pezzo', 'per unit'];

/** Sezioni della pagina il cui contenuto non riguarda il prodotto mostrato. */
const OFF_TOPIC_HINTS = [
	'related', 'correlat', 'similar', 'simili', 'recommend', 'consigliat',
	'review', 'recension', 'cart', 'carrello', 'basket', 'footer', 'header',
	'nav', 'menu', 'cross-sell', 'crosssell', 'upsell', 'you-may-also',
	'altri-prodotti', 'suggeriti', 'wishlist', 'recently-viewed',
];

/** Indizi di un bottone "aggiungi al carrello". */
const CART_HINTS = ['add-to-cart', 'addtocart', 'add_to_cart', 'aggiungi-al-carrello', 'buy-now', 'acquista', 'compra'];
const CART_TEXT = /\b(aggiungi al carrello|acquista ora|compra ora|add to cart|buy now|add to basket)\b/i;

// --- Utilita' --------------------------------------------------------------

/** Concatena class, id e data-* di un elemento, in minuscolo. */
function attrSignature($, element) {
	const node = $(element);
	const parts = [node.attr('class'), node.attr('id')];
	const attribs = element.attribs || {};
	for (const [key, value] of Object.entries(attribs)) {
		if (key.startsWith('data-') || key === 'itemprop') parts.push(`${key}=${value}`);
	}
	return parts.filter(Boolean).join(' ').toLowerCase();
}

/** L'elemento o un suo antenato e' marcato come barrato? */
function isStruck($, element) {
	let node = $(element);
	for (let i = 0; i < 6 && node.length > 0; i++) {
		const tag = (node[0].tagName || node[0].name || '').toLowerCase();
		if (STRIKE_TAGS.has(tag)) return true;

		const style = (node.attr('style') || '').toLowerCase();
		if (style.includes('line-through')) return true;

		const signature = attrSignature($, node[0]);
		if (STRIKE_CLASS_HINTS.some((hint) => signature.includes(hint))) return true;

		node = node.parent();
	}
	return false;
}

/** L'elemento o un antenato e' nascosto? */
function isHidden($, element) {
	let node = $(element);
	for (let i = 0; i < 6 && node.length > 0; i++) {
		if (node.attr('hidden') !== undefined) return true;
		if (node.attr('aria-hidden') === 'true') return true;
		const style = (node.attr('style') || '').toLowerCase().replace(/\s/g, '');
		if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
		node = node.parent();
	}
	return false;
}

/** L'elemento sta in una sezione che non riguarda il prodotto mostrato? */
function isOffTopic($, element) {
	let node = $(element);
	for (let i = 0; i < 8 && node.length > 0; i++) {
		const tag = (node[0].tagName || node[0].name || '').toLowerCase();
		if (tag === 'nav' || tag === 'footer') return true;
		const signature = attrSignature($, node[0]);
		if (OFF_TOPIC_HINTS.some((hint) => signature.includes(hint))) return true;
		node = node.parent();
	}
	return false;
}

/**
 * Testo che qualifica questo prezzo: il suo, piu' i nodi di testo diretti del
 * padre.
 *
 * Deliberatamente stretto. Prendere l'intero testo del padre sembra piu'
 * prudente ma e' sbagliato: su una pagina poco annidata il padre e' <body>, e
 * una frase come "al mese" presente in un angolo qualsiasi farebbe scartare
 * ogni prezzo della pagina, compreso quello giusto.
 */
function nearbyText($, element) {
	const own = $(element).text();
	const parent = $(element).parent();
	const parentDirectText = parent.length > 0
		? parent.contents().filter((_, node) => node.type === 'text').text()
		: '';
	return `${own} ${parentDirectText}`.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300);
}

/** Un antenato vicino e' marcato come prezzo accessorio? */
function hasAccessoryAncestor($, element) {
	let node = $(element);
	for (let i = 0; i < 4 && node.length > 0; i++) {
		const signature = attrSignature($, node[0]);
		if (ACCESSORY_CLASS_HINTS.some((hint) => signature.includes(hint))) return true;
		node = node.parent();
	}
	return false;
}

/** Il testo somiglia a un prezzo? */
function looksLikePrice(text) {
	if (!text) return false;
	const trimmed = text.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_PRICE_TEXT_LENGTH) return false;
	if (trimmed.includes('%')) return false;
	if (!NUMBER.test(trimmed)) return false;

	// Con un marcatore di valuta basta un numero; senza, servono i decimali,
	// altrimenti qualunque cifra della pagina diventa un candidato.
	if (CURRENCY_MARKER.test(trimmed)) return true;
	return /^\s*\d[\d.,\s'’]*[.,]\d{2}\s*$/.test(trimmed);
}

/** Distanza in livelli fra due elementi passando dall'antenato comune. */
function treeDistance($, a, b) {
	const ancestors = (element) => {
		const chain = [];
		let node = $(element);
		while (node.length > 0 && node[0].tagName !== undefined) {
			chain.push(node[0]);
			node = node.parent();
		}
		return chain;
	};

	const chainA = ancestors(a);
	const chainB = ancestors(b);
	const indexB = new Map(chainB.map((node, index) => [node, index]));

	for (let i = 0; i < chainA.length; i++) {
		if (!indexB.has(chainA[i])) continue;

		// Condividere soltanto <body> o <html> non e' prossimita': e' solo
		// "stessa pagina". Contarla come vicinanza fa vincere un prezzo
		// qualunque tanto quanto quello dentro il box di acquisto.
		const tag = (chainA[i].tagName || chainA[i].name || '').toLowerCase();
		if (tag === 'body' || tag === 'html') return Infinity;

		return i + indexB.get(chainA[i]);
	}
	return Infinity;
}

// --- Estrazione ------------------------------------------------------------

/**
 * Elementi che racchiudono un prezzo nel modo piu' stretto possibile: il testo
 * somiglia a un prezzo e nessun discendente fa altrettanto.
 */
function findPriceElements($) {
	const matches = [];

	$('body').find('*').each((_, element) => {
		const tag = (element.tagName || element.name || '').toLowerCase();
		if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

		const text = $(element).text().replace(/\s+/g, ' ').trim();
		if (!looksLikePrice(text)) return;

		// Solo il contenitore piu' interno: se un figlio contiene gia' il
		// prezzo, il padre e' solo un involucro.
		const hasMatchingChild = $(element).children().toArray().some((child) => {
			const childText = $(child).text().replace(/\s+/g, ' ').trim();
			return looksLikePrice(childText);
		});
		if (hasMatchingChild) return;

		matches.push({ element, text });
	});

	return matches;
}

/**
 * @param {import('../document').ScrapeDocument} doc
 * @param {object} [context]
 * @param {number|null} [context.lastKnownPrice] - per premiare la coerenza
 * @returns {Array} candidati, ordinati per punteggio decrescente
 */
function extract(doc, context = {}) {
	const $ = doc.$;
	const { lastKnownPrice = null } = context;

	const found = findPriceElements($);
	if (found.length === 0) return [];

	// Bottone di acquisto: la prossimita' e' il segnale singolo piu' forte.
	let cartElement = null;
	$('button, a, input[type="submit"], form').each((_, element) => {
		if (cartElement) return;
		const signature = attrSignature($, element);
		const text = $(element).text().replace(/\s+/g, ' ').trim();
		if (CART_HINTS.some((hint) => signature.includes(hint)) || CART_TEXT.test(text)) {
			cartElement = element;
		}
	});

	const totalElements = $('body').find('*').length || 1;
	const documentOrder = new Map();
	$('body').find('*').each((index, element) => documentOrder.set(element, index));

	// Prezzi barrati: servono dopo, per riconoscere il pattern sconto.
	const struckValues = [];
	const kept = [];

	for (const { element, text } of found) {
		const parsed = parsePriceDetailed(text);
		if (parsed.value === null) continue;

		if (isStruck($, element)) {
			struckValues.push(parsed.value);
			continue;
		}
		if (isHidden($, element)) continue;
		if (isOffTopic($, element)) continue;

		const signature = attrSignature($, element);
		if (hasAccessoryAncestor($, element)) continue;

		const near = nearbyText($, element);
		if (ACCESSORY_TEXT_HINTS.some((hint) => near.includes(hint))) continue;
		if (UNIT_HINTS.some((hint) => near.includes(hint))) continue;

		kept.push({ element, text, value: parsed.value, signature, near });
	}

	if (kept.length === 0) return [];

	// --- Punteggio ---
	const scored = kept.map((entry) => {
		let score = 0;
		const signals = [];

		if (cartElement) {
			const distance = treeDistance($, entry.element, cartElement);
			if (distance <= 3) { score += 0.25; signals.push('vicino-al-carrello'); }
			else if (distance <= 6) { score += 0.12; signals.push('carrello-a-media-distanza'); }
		}

		if (/price|prezzo|amount/.test(entry.signature)) {
			score += 0.20; signals.push('classe-prezzo');
		}

		if (lastKnownPrice !== null && lastKnownPrice > 0) {
			const ratio = entry.value / lastKnownPrice;
			if (ratio >= 0.6 && ratio <= 1.4) { score += 0.25; signals.push('coerente-con-storico'); }
		}

		// Un barrato piu' alto nella pagina e' il pattern sconto classico.
		if (struckValues.some((struck) => struck > entry.value)) {
			score += 0.15; signals.push('sconto-su-barrato');
		}

		const position = (documentOrder.get(entry.element) ?? totalElements) / totalElements;
		if (position <= 0.5) { score += 0.10; signals.push('parte-alta'); }

		if (/itemprop=price/.test(entry.signature)) {
			score += 0.15; signals.push('itemprop-prezzo');
		}

		return { ...entry, score, signals };
	});

	scored.sort((a, b) => b.score - a.score || a.value - b.value);

	// Unicita': se il secondo classificato ha un punteggio simile ma un valore
	// diverso, la scelta non e' netta e il peso va abbassato. E' il segnale che
	// la validazione usera' per mandare in quarantena invece di fidarsi.
	const best = scored[0];
	const runnerUp = scored.find((entry) => entry.value !== best.value);
	const ambiguous = runnerUp !== undefined && (best.score - runnerUp.score) <= 0.10;
	if (!ambiguous) best.score += 0.10;

	const candidates = [candidate({
		field: 'price',
		value: best.value,
		raw: best.text,
		source: 'dom',
		path: best.signature || 'dom',
		evidence: best.text,
		weight: Math.min(0.55 + best.score * 0.3, 0.85),
		meta: {
			score: Math.round(best.score * 100) / 100,
			signals: best.signals,
			ambiguous,
			consideredCount: scored.length,
			discardedStruck: struckValues.length,
		},
	})];

	// La valuta si legge dal testo del prezzo vincente.
	const currencyMatch = CURRENCY_MARKER.exec(best.text);
	if (currencyMatch) {
		const { normalizeCurrency } = require('../normalize/currency');
		const code = normalizeCurrency(currencyMatch[0], { url: doc.url, fallback: null });
		if (code) {
			candidates.push(candidate({
				field: 'currency', value: code, raw: currencyMatch[0], source: 'dom', path: best.signature,
			}));
		}
	}

	return compact(candidates);
}

module.exports = {
	extract,
	looksLikePrice,
	findPriceElements,
	isStruck,
	isHidden,
	isOffTopic,
	hasAccessoryAncestor,
	nearbyText,
	treeDistance,
	name: 'dom',
};
