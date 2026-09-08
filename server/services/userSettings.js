/**
 * Normalizzazione delle impostazioni utente.
 *
 * Estratta come funzione pura per essere testabile senza database: la riga
 * arriva da user_settings, l'uscita e' l'insieme di valori effettivi che il
 * price tracker usa.
 *
 * Unita' di misura: price_check_interval e' in MINUTI. E' quello che dice la
 * UI ("Price Check Interval (minutes)", default 360) ed e' come lo interpreta
 * il tracker. Il commento di user_settings_schema.sql diceva "hours" con
 * default 6: era l'unico posto in disaccordo, corretto insieme a questo
 * modulo (difetto D9 del design doc).
 */

const DEFAULTS = Object.freeze({
	priceCheckIntervalMinutes: 360,
	scrapeDelayMs: 2000,
	maxRetries: 1,
	emailNotifications: true,
});

// Pavimento di sicurezza. Le righe create prima che la UI esistesse portano
// price_check_interval = 6 (il vecchio default "ore"): letto come minuti
// significherebbe interrogare ogni store ogni 6 minuti per ogni prodotto.
// Finche' non arriva il rate limiting per dominio (fase 6) il pavimento e'
// l'unica protezione, sia per gli store sia per noi.
const MIN_PRICE_CHECK_INTERVAL_MINUTES = 15;
const MIN_SCRAPE_DELAY_MS = 500;
const MAX_SCRAPE_DELAY_MS = 60000;
const MAX_RETRIES_CAP = 5;

/**
 * Converte un valore in intero positivo, oppure restituisce il fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
	const parsed = typeof value === 'number' ? value : parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

/**
 * @param {object|null|undefined} row - riga di user_settings, o null se assente
 * @returns {{priceCheckIntervalMinutes:number, scrapeDelayMs:number, maxRetries:number, emailNotifications:boolean}}
 */
function normalizeUserSettings(row) {
	if (!row || typeof row !== 'object') return { ...DEFAULTS };

	const interval = positiveInt(row.price_check_interval, DEFAULTS.priceCheckIntervalMinutes);
	const delay = positiveInt(row.scrape_delay, DEFAULTS.scrapeDelayMs);

	// max_retries e' l'unico campo dove 0 e' un valore legittimo (nessun retry).
	const rawRetries = typeof row.max_retries === 'number' ? row.max_retries : parseInt(row.max_retries, 10);
	const retries = Number.isFinite(rawRetries) && rawRetries >= 0
		? clamp(Math.floor(rawRetries), 0, MAX_RETRIES_CAP)
		: DEFAULTS.maxRetries;

	return {
		priceCheckIntervalMinutes: Math.max(interval, MIN_PRICE_CHECK_INTERVAL_MINUTES),
		scrapeDelayMs: clamp(delay, MIN_SCRAPE_DELAY_MS, MAX_SCRAPE_DELAY_MS),
		maxRetries: retries,
		emailNotifications: row.email_notifications ?? DEFAULTS.emailNotifications,
	};
}

module.exports = {
	normalizeUserSettings,
	DEFAULTS,
	MIN_PRICE_CHECK_INTERVAL_MINUTES,
	MIN_SCRAPE_DELAY_MS,
	MAX_SCRAPE_DELAY_MS,
	MAX_RETRIES_CAP,
};
