/**
 * Limitazione di frequenza per dominio.
 *
 * Con la whitelist il numero di domini era noto e piccolo; aperto a qualunque
 * shop, il motore puo' martellare un sito piccolo con tutti i prodotti di
 * tutti gli utenti. Il limite e' condiviso fra utenti proprio per questo: e'
 * una proprieta' del dominio, non della coda di un singolo.
 *
 * Token bucket: consente raffiche brevi entro la capienza, poi impone il ritmo
 * medio. E' il comportamento giusto per lo scraping, dove i controlli arrivano
 * a lotti.
 */

const DEFAULT_RPM = 6;
const DEFAULT_MIN_INTERVAL_MS = 10000;

/**
 * @param {object} [options]
 * @param {function} [options.now] - orologio iniettabile
 * @param {number} [options.defaultRpm]
 * @param {number} [options.defaultMinIntervalMs]
 */
function createRateLimiter(options = {}) {
	const {
		now = () => Date.now(),
		defaultRpm = DEFAULT_RPM,
		defaultMinIntervalMs = DEFAULT_MIN_INTERVAL_MS,
	} = options;

	const buckets = new Map();

	function bucketFor(domain, config = {}) {
		const rpm = config.rate_limit_rpm ?? config.rpm ?? defaultRpm;
		const minInterval = config.min_interval_ms ?? config.minIntervalMs ?? defaultMinIntervalMs;

		let bucket = buckets.get(domain);
		if (!bucket) {
			// lastRequest e' null - non 0 - finche' non c'e' stata una richiesta:
			// con un orologio che parte da zero, 0 sarebbe un istante valido e
			// l'intervallo minimo non verrebbe mai applicato alla seconda
			// richiesta.
			bucket = {
				tokens: rpm, capacity: rpm, rpm, minInterval,
				lastRefill: now(), lastRequest: null,
				penaltyUntil: null,
			};
			buckets.set(domain, bucket);
		} else {
			// La configurazione puo' cambiare quando arriva il profilo dominio.
			bucket.rpm = rpm;
			bucket.capacity = rpm;
			bucket.minInterval = minInterval;
		}
		return bucket;
	}

	function refill(bucket) {
		const current = now();
		const elapsed = current - bucket.lastRefill;
		if (elapsed <= 0) return;
		const gained = (elapsed / 60000) * bucket.rpm;
		bucket.tokens = Math.min(bucket.capacity, bucket.tokens + gained);
		bucket.lastRefill = current;
	}

	/**
	 * Si puo' interrogare questo dominio adesso?
	 *
	 * @returns {{allowed: boolean, waitMs: number}} waitMs dice quanto
	 *   aspettare, cosi' il chiamante puo' riaccodare invece di scartare
	 */
	function tryAcquire(domain, config = {}) {
		const bucket = bucketFor(domain, config);
		refill(bucket);

		const current = now();

		// La penalita' e' tenuta separata dalla configurazione perche' la
		// configurazione viene riapplicata a ogni chiamata (arriva dal profilo
		// dominio): scriverla dentro minInterval la farebbe cancellare dalla
		// richiesta successiva, cioe' proprio quando deve valere.
		if (bucket.penaltyUntil !== null) {
			if (current < bucket.penaltyUntil) {
				return { allowed: false, waitMs: Math.ceil(bucket.penaltyUntil - current) };
			}
			bucket.penaltyUntil = null;
		}

		// Intervallo minimo fra due richieste: evita la raffica ravvicinata
		// anche quando i gettoni ci sarebbero.
		const sinceLast = bucket.lastRequest === null ? Infinity : current - bucket.lastRequest;
		if (sinceLast < bucket.minInterval) {
			return { allowed: false, waitMs: Math.ceil(bucket.minInterval - sinceLast) };
		}

		if (bucket.tokens < 1) {
			const missing = 1 - bucket.tokens;
			return { allowed: false, waitMs: Math.ceil((missing / bucket.rpm) * 60000) };
		}

		bucket.tokens -= 1;
		bucket.lastRequest = current;
		return { allowed: true, waitMs: 0 };
	}

	/**
	 * Segnala che il dominio ci ha risposto 429 o 503: si consumano i gettoni
	 * residui e si rispetta l'eventuale Retry-After.
	 */
	function penalize(domain, retryAfterSeconds = null) {
		const bucket = bucketFor(domain);
		bucket.tokens = 0;
		bucket.lastRequest = now();

		// Retry-After e' un impegno: si rispetta com'e', anche se e' piu' lungo
		// del nostro intervallo abituale.
		const waitMs = retryAfterSeconds
			? retryAfterSeconds * 1000
			: bucket.minInterval;
		bucket.penaltyUntil = now() + waitMs;
	}

	function stats() {
		return [...buckets.entries()].map(([domain, bucket]) => ({
			domain,
			tokens: Math.round(bucket.tokens * 100) / 100,
			rpm: bucket.rpm,
		}));
	}

	function reset() {
		buckets.clear();
	}

	return { tryAcquire, penalize, stats, reset };
}

module.exports = { createRateLimiter, DEFAULT_RPM, DEFAULT_MIN_INTERVAL_MS };
