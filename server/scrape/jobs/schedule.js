/**
 * Quando va ricontrollato un prodotto.
 *
 * Logica pura, separata dalla coda per essere verificabile senza database.
 *
 * L'intervallo scelto dall'utente e' il punto di partenza, non la regola
 * assoluta: un prodotto fermo da un mese non merita la stessa frequenza di uno
 * che cambia prezzo ogni giorno, e un prodotto rotto va interrogato sempre piu'
 * di rado invece di continuare a sbatterci contro.
 */

const MINUTE = 60000;

const LIMITS = Object.freeze({
	MIN_INTERVAL_MINUTES: 15,
	MAX_INTERVAL_MINUTES: 60 * 48,   // due giorni
	VOLATILE_FACTOR: 0.5,            // prezzi che si muovono: piu' spesso
	STALE_FACTOR: 2,                 // prodotti fermi: piu' di rado
	STALE_AFTER_DAYS: 30,
	BROKEN_BACKOFF_BASE: 2,
});

/**
 * Priorita' di un job: piu' bassa viene servita prima.
 *
 * @param {object} product
 * @returns {number}
 */
function priorityOf(product) {
	// Un prodotto mai controllato viene prima di tutti: senza un primo prezzo
	// non c'e' nulla da mostrare all'utente.
	if (!product.last_checked_at) return 10;
	if (product.target_price) return 50;      // qualcuno aspetta una soglia
	if (product.tracking_health === 'broken') return 200;
	return 100;
}

/**
 * Intervallo effettivo fra due controlli.
 *
 * @param {object} product
 * @param {number} baseIntervalMinutes - dall'impostazione utente
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {{minutes: number, reason: string}}
 */
function intervalFor(product, baseIntervalMinutes, options = {}) {
	const { now = new Date() } = options;

	// Prodotto rotto: backoff esponenziale sui fallimenti consecutivi. Non ha
	// senso interrogare ogni ora una pagina che non risponde da giorni.
	const failures = product.consecutive_failures ?? 0;
	if (product.tracking_health === 'broken' && failures > 0) {
		const factor = Math.pow(LIMITS.BROKEN_BACKOFF_BASE, Math.min(failures, 6));
		return {
			minutes: Math.min(baseIntervalMinutes * factor, LIMITS.MAX_INTERVAL_MINUTES),
			reason: 'backoff-fallimenti',
		};
	}

	if (product.tracking_health === 'blocked') {
		return { minutes: LIMITS.MAX_INTERVAL_MINUTES, reason: 'dominio-bloccato' };
	}

	// Prezzo fermo da tanto: si dirada.
	const lastChange = product.last_price_change_at || product.last_success_at;
	if (lastChange) {
		const days = (now.getTime() - new Date(lastChange).getTime()) / (24 * 60 * MINUTE);
		if (days >= LIMITS.STALE_AFTER_DAYS) {
			return {
				minutes: Math.min(baseIntervalMinutes * LIMITS.STALE_FACTOR, LIMITS.MAX_INTERVAL_MINUTES),
				reason: 'prezzo-fermo',
			};
		}
	}

	// Prezzo volatile: si infittisce, ma mai sotto il pavimento.
	if (product.price_volatile) {
		return {
			minutes: Math.max(baseIntervalMinutes * LIMITS.VOLATILE_FACTOR, LIMITS.MIN_INTERVAL_MINUTES),
			reason: 'prezzo-volatile',
		};
	}

	return { minutes: baseIntervalMinutes, reason: 'intervallo-utente' };
}

/**
 * Il prodotto e' dovuto adesso?
 * @returns {{due: boolean, dueAt: Date, reason: string}}
 */
function isDue(product, baseIntervalMinutes, options = {}) {
	const { now = new Date() } = options;
	const { minutes, reason } = intervalFor(product, baseIntervalMinutes, { now });

	const lastChecked = product.last_checked_at ? new Date(product.last_checked_at) : null;
	if (!lastChecked) return { due: true, dueAt: now, reason: 'mai-controllato' };

	const dueAt = new Date(lastChecked.getTime() + minutes * MINUTE);
	return { due: now >= dueAt, dueAt, reason };
}

module.exports = { isDue, intervalFor, priorityOf, LIMITS };
