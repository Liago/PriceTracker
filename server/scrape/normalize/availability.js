/**
 * Normalizzazione della disponibilita' a un enum.
 *
 * Oggi gli scraper restituiscono un booleano `available`, e questo e' il
 * problema: "non lo so" diventa false, cioe' "esaurito". Un prodotto che
 * risulta esaurito per un errore di lettura e' indistinguibile da uno esaurito
 * davvero, e nessuno se ne accorge.
 */

const AVAILABILITY = Object.freeze({
	IN_STOCK: 'in_stock',
	OUT_OF_STOCK: 'out_of_stock',
	PREORDER: 'preorder',
	BACKORDER: 'backorder',
	DISCONTINUED: 'discontinued',
	UNKNOWN: 'unknown',
});

// schema.org/ItemAvailability, con e senza prefisso URL.
const SCHEMA_ORG = Object.freeze({
	instock: AVAILABILITY.IN_STOCK,
	onlineonly: AVAILABILITY.IN_STOCK,
	instoreonly: AVAILABILITY.IN_STOCK,
	limitedavailability: AVAILABILITY.IN_STOCK,
	outofstock: AVAILABILITY.OUT_OF_STOCK,
	soldout: AVAILABILITY.OUT_OF_STOCK,
	preorder: AVAILABILITY.PREORDER,
	preordermetadata: AVAILABILITY.PREORDER,
	backorder: AVAILABILITY.BACKORDER,
	discontinued: AVAILABILITY.DISCONTINUED,
});

// Frasi in italiano e inglese, dalla piu' specifica alla piu' generica:
// l'ordine conta perche' "non disponibile" contiene "disponibile".
const TEXT_PATTERNS = Object.freeze([
	[/\b(non più disponibile|fuori produzione|discontinued|no longer available)\b/i, AVAILABILITY.DISCONTINUED],
	[/\b(pre-?ordina|pre-?order|prenota ora)\b/i, AVAILABILITY.PREORDER],
	[/\b(su ordinazione|in arrivo|back-?order)\b/i, AVAILABILITY.BACKORDER],
	[/\b(non disponibile|esaurito|out of stock|sold out|currently unavailable|non è disponibile|terminato)\b/i, AVAILABILITY.OUT_OF_STOCK],
	[/\b(disponibile|in stock|disponibilità immediata|pronta consegna|aggiungi al carrello|add to cart)\b/i, AVAILABILITY.IN_STOCK],
]);

/**
 * @param {string|boolean|null|undefined} input - stringa schema.org, testo
 *   libero della pagina, oppure il booleano legacy degli scraper attuali
 * @returns {string} uno dei valori di AVAILABILITY; 'unknown' se indecidibile
 */
function normalizeAvailability(input) {
	if (input === null || input === undefined || input === '') return AVAILABILITY.UNKNOWN;

	// Booleano: e' il formato dei vecchi scraper. Si converte, ma resta il
	// limite d'origine: quel false poteva significare "non lo so".
	if (typeof input === 'boolean') {
		return input ? AVAILABILITY.IN_STOCK : AVAILABILITY.OUT_OF_STOCK;
	}

	const text = String(input).trim();
	if (text === '') return AVAILABILITY.UNKNOWN;

	// Valore gia' normalizzato.
	const asEnum = text.toLowerCase().replace(/[\s-]+/g, '_');
	if (Object.values(AVAILABILITY).includes(asEnum)) return asEnum;

	// schema.org: si prende l'ultimo segmento dell'URL o il valore nudo.
	const lastSegment = text.split(/[/#]/).pop().toLowerCase().replace(/[^a-z]/g, '');
	if (SCHEMA_ORG[lastSegment]) return SCHEMA_ORG[lastSegment];

	for (const [pattern, value] of TEXT_PATTERNS) {
		if (pattern.test(text)) return value;
	}

	return AVAILABILITY.UNKNOWN;
}

/**
 * Compatibilita' con il campo booleano `available` usato dagli scraper e
 * salvato dentro products.details finche' la fase 4 non lo promuove a colonna.
 * @param {string} availability
 * @returns {boolean|null} null quando la disponibilita' e' ignota
 */
function toLegacyBoolean(availability) {
	switch (availability) {
		case AVAILABILITY.IN_STOCK:
		case AVAILABILITY.PREORDER:
		case AVAILABILITY.BACKORDER:
			return true;
		case AVAILABILITY.OUT_OF_STOCK:
		case AVAILABILITY.DISCONTINUED:
			return false;
		default:
			return null;
	}
}

module.exports = {
	normalizeAvailability,
	toLegacyBoolean,
	AVAILABILITY,
};
