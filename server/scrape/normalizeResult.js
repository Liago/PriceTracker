/**
 * Normalizzazione del risultato grezzo di uno scraper.
 *
 * Gli scraper restituiscono prezzo come stringa, valuta come capita e
 * disponibilita' come booleano. Questo modulo e' il punto in cui quel materiale
 * diventa dato: e' l'unico posto dove la conversione avviene, ed e' condiviso
 * fra l'API Express e la function Netlify, che finora avevano due copie della
 * stessa logica.
 *
 * Compatibilita': i campi originali (price stringa, available booleano)
 * restano nella risposta finche' il client non e' migrato. I campi nuovi sono
 * additivi.
 */

const { parsePriceDetailed } = require('./normalize/price');
const { normalizeCurrencyDetailed } = require('./normalize/currency');
const { normalizeAvailability, toLegacyBoolean, AVAILABILITY } = require('./normalize/availability');

/**
 * @param {object} raw - uscita di uno scraper
 * @param {string} [url] - URL analizzato, serve a sciogliere le valute ambigue
 * @returns {object} risultato arricchito
 */
function normalizeScrapeResult(raw, url) {
	if (!raw || typeof raw !== 'object') {
		return {
			priceValue: null,
			currency: null,
			availability: AVAILABILITY.UNKNOWN,
			available: null,
			normalization: { priceReason: 'empty', currencyAmbiguous: false, hadRange: false },
		};
	}

	const priceInfo = parsePriceDetailed(raw.price);

	// La valuta dichiarata dallo scraper ha la precedenza; in sua assenza si
	// tenta di leggerla dal simbolo dentro la stringa del prezzo.
	const currencySource = raw.currency !== undefined && raw.currency !== null && raw.currency !== ''
		? raw.currency
		: raw.price;
	const currencyInfo = normalizeCurrencyDetailed(currencySource, { url });

	// availability esplicita se presente, altrimenti il booleano legacy.
	const availabilityInput = raw.availability !== undefined && raw.availability !== null
		? raw.availability
		: raw.available;
	const availability = normalizeAvailability(availabilityInput);

	return {
		...raw,
		// Campi normalizzati
		priceValue: priceInfo.value,
		currency: currencyInfo.code,
		availability,
		// Campo legacy, ricalcolato dall'enum per restare coerente
		available: toLegacyBoolean(availability),
		normalization: {
			priceReason: priceInfo.reason,
			hadRange: priceInfo.hadRange,
			currencyAmbiguous: currencyInfo.ambiguous,
			currencySource: currencyInfo.source,
		},
	};
}

module.exports = { normalizeScrapeResult };
