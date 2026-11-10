/**
 * Aggiornamento della scheda prodotto dopo un controllo riuscito.
 *
 * La scheda (descrizione, caratteristiche, specifiche, valutazione, categoria)
 * si legge a ogni controllo insieme al prezzo. Va salvata solo quando il
 * controllo e' stato accettato - una pagina di sfida o una variante diversa
 * non devono riscrivere la scheda - e senza mai cancellare cio' che c'era: una
 * lettura che non trova le specifiche (tier 0 senza JavaScript, layout
 * cambiato) lascia quelle precedenti.
 *
 * Le informazioni vivono in products.details, accanto a `variant`, che resta
 * di competenza della funzione transazionale del controllo.
 */

const INFO_KEYS = ['features', 'specs', 'rating', 'breadcrumbs', 'category', 'seller', 'condition'];

function isPresent(value) {
	if (value === null || value === undefined || value === '') return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'object') return Object.keys(value).length > 0;
	return true;
}

function sameJson(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Le modifiche da applicare alla riga del prodotto, o null se non c'e' nulla
 * di nuovo.
 *
 * @param {object} product - riga corrente di products
 * @param {object} scraped - uscita dello scraper (interpret)
 * @param {object} [descriptor] - offerta appena salvata, per non perdere la variante
 * @returns {object|null}
 */
function productInfoPatch(product, scraped, descriptor = null) {
	if (!product || !scraped) return null;
	const current = product.details && typeof product.details === 'object' ? product.details : {};
	const incoming = scraped.details && typeof scraped.details === 'object' ? scraped.details : {};

	const details = { ...current };
	let changed = false;
	for (const key of INFO_KEYS) {
		if (isPresent(incoming[key]) && !sameJson(current[key], incoming[key])) {
			details[key] = incoming[key];
			changed = true;
		}
	}
	// La funzione del controllo ha appena scritto la variante dell'offerta:
	// riscriverla uguale evita di riportare indietro quella vecchia.
	if (descriptor && descriptor.variant && typeof descriptor.variant === 'object') details.variant = descriptor.variant;

	const patch = {};
	if (changed) patch.details = details;

	// La descrizione non si accorcia: una lettura dal solo meta tag non deve
	// sostituire il testo completo letto in precedenza.
	const description = typeof scraped.description === 'string' ? scraped.description.trim() : '';
	const previous = typeof product.description === 'string' ? product.description.trim() : '';
	if (description && description !== previous && description.length >= previous.length) patch.description = description;

	if (!product.brand && scraped.brand) patch.brand = scraped.brand;
	if (!product.image && scraped.image) patch.image = scraped.image;

	return Object.keys(patch).length > 0 ? patch : null;
}

module.exports = { productInfoPatch, INFO_KEYS };
