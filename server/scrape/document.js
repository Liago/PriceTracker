/**
 * Document: la pagina su cui lavorano gli estrattori.
 *
 * Costruito da una stringa HTML con cheerio, che e' gia' una dipendenza del
 * progetto. La scelta di lavorare sull'HTML e non sul `page` di Puppeteer e'
 * deliberata: gli estrattori diventano testabili contro fixture salvate su
 * disco, e lo stesso codice servira' il tier 0 (fetch HTTP senza browser)
 * previsto dal design doc. Quando la pipeline gira dietro un browser, l'HTML
 * si ottiene con page.content().
 *
 * Limite noto: senza browser non esiste lo stile calcolato, quindi le
 * euristiche DOM usano solo segnali strutturali (tag, classi, attributi,
 * stile inline). Il raffinamento con font-size e line-through calcolati e'
 * un'aggiunta del tier 2, non una precondizione.
 */

const { load } = require('cheerio');

/**
 * Estensione bilanciata di un valore JSON a partire da una posizione.
 *
 * Conta le parentesi rispettando le stringhe e gli escape, quindi non si fa
 * confondere da una parentesi che compare dentro un valore testuale.
 *
 * @param {string} text
 * @param {number} start - indice di una '{' o di una '['
 * @returns {string|null} il valore bilanciato, oppure null se non si chiude
 */
function balancedSpan(text, start) {
	const open = text[start];
	if (open !== '{' && open !== '[') return null;
	const close = open === '{' ? '}' : ']';

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];

		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') { inString = true; continue; }
		if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}

	return null;
}

/**
 * Parsing tollerante di un blocco JSON-LD.
 *
 * Gli shop avvolgono il JSON-LD nei modi piu' vari: CDATA, commenti HTML
 * annidati (Drupal, Magento), spaziatura di template, virgole finali. Invece
 * di ripulire il contorno con delle regex - fragile: un pattern per i commenti
 * finisce per mangiarsi il JSON stesso, e "<![CDATA[" contiene una parentesi
 * quadra che inganna un ritaglio ingenuo - si prova a parsare il valore
 * bilanciato a partire da ogni parentesi aperta, in ordine, tenendo il primo
 * che si rivela JSON valido.
 *
 * @param {string} raw
 * @returns {*} il valore parsato, oppure undefined se irrecuperabile
 */
function parseJsonLoosely(raw) {
	const text = String(raw).trim();
	if (text === '') return undefined;

	const tryParse = (chunk) => {
		if (!chunk) return undefined;
		try {
			return JSON.parse(chunk);
		} catch (e) {
			try {
				// Virgola finale prima di una parentesi: l'errore piu' comune nei
				// template generati a mano.
				return JSON.parse(chunk.replace(/,\s*([}\]])/g, '$1'));
			} catch (e2) {
				return undefined;
			}
		}
	};

	// Caso normale: il blocco e' gia' JSON puro.
	const direct = tryParse(text);
	if (direct !== undefined) return direct;

	// Caso avvolto: si tenta da ogni parentesi aperta, fermandosi a un numero
	// ragionevole di tentativi per non pagare un costo patologico su input
	// ostili.
	const MAX_ATTEMPTS = 12;
	let attempts = 0;

	for (let i = 0; i < text.length && attempts < MAX_ATTEMPTS; i++) {
		if (text[i] !== '{' && text[i] !== '[') continue;
		attempts++;
		const parsed = tryParse(balancedSpan(text, i));
		if (parsed !== undefined) return parsed;
	}

	return undefined;
}

class ScrapeDocument {
	/**
	 * @param {string} html
	 * @param {object} [options]
	 * @param {string} [options.url] - URL di provenienza
	 */
	constructor(html, options = {}) {
		this.html = typeof html === 'string' ? html : '';
		this.url = options.url || null;
		this.$ = load(this.html);
		this._jsonLd = null;
	}

	/**
	 * Blocchi JSON-LD della pagina, gia' parsati.
	 *
	 * Tollerante: un blocco malformato non fa fallire gli altri. Gli shop
	 * generano JSON-LD con virgole finali, commenti HTML e CDATA piu' spesso
	 * di quanto ci si aspetti.
	 *
	 * @returns {Array<object>}
	 */
	jsonLdBlocks() {
		if (this._jsonLd) return this._jsonLd;

		const blocks = [];
		this.$('script[type="application/ld+json"]').each((_, element) => {
			const raw = this.$(element).contents().text();
			if (!raw || !raw.trim()) return;

			const parsed = parseJsonLoosely(raw);
			if (parsed !== undefined) blocks.push(parsed);
		});

		this._jsonLd = blocks;
		return blocks;
	}

	/**
	 * Contenuto di un meta tag, cercato sia per property sia per name.
	 * @param {string} key
	 * @returns {string|null}
	 */
	meta(key) {
		const escaped = key.replace(/"/g, '\\"');
		const element = this.$(`meta[property="${escaped}"]`).first().attr('content')
			?? this.$(`meta[name="${escaped}"]`).first().attr('content')
			?? this.$(`meta[itemprop="${escaped}"]`).first().attr('content');
		return element !== undefined && element !== null && element !== '' ? element : null;
	}

	/** @returns {string|null} */
	title() {
		const value = this.$('title').first().text();
		return value ? value.trim() : null;
	}

	/**
	 * Testo di un selettore, normalizzato negli spazi.
	 * @param {string} selector
	 * @returns {string|null}
	 */
	text(selector) {
		const node = this.$(selector).first();
		if (node.length === 0) return null;
		const value = node.text().replace(/\s+/g, ' ').trim();
		return value === '' ? null : value;
	}

	/**
	 * Attributo di un selettore.
	 * @returns {string|null}
	 */
	attr(selector, name) {
		const value = this.$(selector).first().attr(name);
		return value === undefined || value === '' ? null : value;
	}

	/** @returns {boolean} */
	has(selector) {
		return this.$(selector).length > 0;
	}

	/**
	 * URL canonico dichiarato dalla pagina, altrimenti quello di provenienza.
	 * @returns {string|null}
	 */
	canonicalUrl() {
		return this.attr('link[rel="canonical"]', 'href') || this.meta('og:url') || this.url;
	}

	/**
	 * Testo dell'intero body, per le ricerche testuali grossolane.
	 * @returns {string}
	 */
	bodyText() {
		return this.$('body').text().replace(/\s+/g, ' ').trim();
	}
}

/**
 * @param {string} html
 * @param {object} [options]
 * @returns {ScrapeDocument}
 */
function createDocument(html, options) {
	return new ScrapeDocument(html, options);
}

module.exports = { ScrapeDocument, createDocument, parseJsonLoosely, balancedSpan };
