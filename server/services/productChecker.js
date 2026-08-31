/**
 * Controllo di un singolo prodotto: decide, e lascia al repository il compito
 * di persistere.
 *
 * Separare la decisione dalla scrittura e' cio' che rende questo passaggio
 * verificabile senza database - ed e' il passaggio piu' delicato del refactor,
 * perche' e' qui che si stabilisce se un prezzo entra nella storia.
 *
 * Differenza rispetto al comportamento attuale (difetti D7 e D8):
 *
 *  - ogni controllo produce un'osservazione, anche quando il prezzo non cambia
 *    e anche quando fallisce. Oggi un fallimento fa continue e lascia credere
 *    che il prezzo sia stabile;
 *  - un prezzo non plausibile viene registrato ma NON scritto su
 *    current_price. Oggi ci finisce senza che nessuno se ne accorga.
 */

const { parsePrice } = require('../scrape/normalize/price');
const { normalizeCurrency } = require('../scrape/normalize/currency');
const { normalizeAvailability, AVAILABILITY } = require('../scrape/normalize/availability');
const { describeOffer } = require('../scrape/normalize/offer');
const { validatePrice, nextTrackingHealth, OUTCOME, REJECT } = require('../scrape/score/validate');

/**
 * Confidenza del risultato.
 *
 * Dalla fase 5 la pipeline generica e' il percorso primario e produce una
 * confidenza propria, calcolata sull'accordo fra sorgenti indipendenti. Non
 * serve piu' dedurla dall'accordo con gli scraper dedicati, che non esistono
 * piu'.
 *
 * @param {object} scraped - uscita di scrapeProduct
 * @returns {{confidence: number, source: string}}
 */
function confidenceOf(scraped) {
	if (typeof scraped?.confidence === 'number') {
		return {
			confidence: scraped.confidence,
			source: scraped.fields?.price?.source ?? 'pipeline',
		};
	}
	// Un risultato senza confidenza non e' interpretabile: si tratta come tale.
	return { confidence: 0, source: 'sconosciuta' };
}

/**
 * Controlla un prodotto e restituisce cio' che e' stato deciso e fatto.
 *
 * @param {object} params
 * @param {object} params.product - riga di products
 * @param {function} params.scrape - (url) => Promise<risultato scraper>
 * @param {object} params.repo - repository di persistenza
 * @param {function} [params.now] - orologio iniettabile
 * @returns {Promise<object>} esito del controllo
 */
async function checkProduct({ product, scrape, repo, now = () => new Date() }) {
	const startedAt = now();
	const outcomeBase = {
		productId: product.id,
		productName: product.name,
		url: product.url,
	};

	// 1. Scrape. Un'eccezione qui e' un fallimento come un altro: va
	// registrato, non ingoiato.
	let scraped = null;
	let scrapeError = null;
	try {
		scraped = await scrape(product.url);
	} catch (error) {
		scrapeError = error.message || String(error);
	}

	const { confidence, source } = confidenceOf(scraped);

	const price = scrapeError ? null : parsePrice(scraped?.priceValue ?? scraped?.price);
	const currency = scrapeError
		? null
		: normalizeCurrency(scraped?.currency ?? scraped?.price, { url: product.url, fallback: null });
	const availability = scrapeError
		? AVAILABILITY.UNKNOWN
		: normalizeAvailability(scraped?.availability ?? scraped?.available);

	// 2. Offerta. Anche quando la pagina non espone varianti serve un'offerta:
	// e' l'ancora della serie storica.
	const offerDescriptor = describeOffer(
		{
			seller: scraped?.details?.seller,
			condition: scraped?.details?.condition,
			gtin: scraped?.gtin,
			sku: scraped?.sku,
		},
		product.url,
	);
	const offer = await repo.ensureOffer(product, offerDescriptor);

	// 3. Storico dell'offerta, per i controlli di plausibilita'.
	const history = await repo.getRecentObservations(offer.id, 5);

	// 4. Validazione.
	const validation = scrapeError
		? { outcome: OUTCOME.QUARANTINED, accepted: false, reasons: ['errore_di_scrape'], checks: {} }
		: validatePrice({
			price,
			currency,
			availability,
			confidence,
			identity: { gtin: scraped?.gtin, sku: scraped?.sku },
			knownIdentity: { gtin: product.gtin, sku: product.sku },
			knownCurrency: product.currency,
			history,
		});

	// 5. Osservazione: si scrive SEMPRE, accettata o no. E' la differenza fra
	// "prezzo stabile" e "scraper rotto da tre settimane".
	await repo.insertObservation({
		product_id: product.id,
		offer_id: offer.id,
		price,
		currency,
		availability,
		confidence,
		accepted: validation.accepted,
		reject_reason: validation.accepted ? null : validation.reasons.join(','),
		observed_at: startedAt.toISOString(),
	});

	// 6. Salute del tracking.
	const identityChanged = validation.reasons.includes(REJECT.IDENTITY_CHANGED);
	const health = nextTrackingHealth({
		outcome: validation.outcome,
		consecutiveFailures: product.consecutive_failures ?? 0,
		identityChanged,
	});

	// 7. Aggiornamento del prodotto.
	//
	// current_price viene toccato SOLO se il prezzo e' stato accettato. E' la
	// regola d'oro: un fallimento non scrive mai un prezzo.
	const patch = {
		last_checked_at: startedAt.toISOString(),
		tracking_health: health.health,
		consecutive_failures: health.consecutiveFailures,
		availability,
	};
	if (validation.accepted) {
		patch.current_price = price;
		patch.last_success_at = startedAt.toISOString();
		if (currency) patch.currency = currency;
	}
	await repo.updateProduct(product.id, patch);

	if (validation.accepted) {
		await repo.updateOffer(offer.id, {
			current_price: price,
			currency,
			availability,
			last_seen_at: startedAt.toISOString(),
		});
	}

	// 8. Storia e notifiche solo su un prezzo accettato che e' cambiato.
	const previousPrice = product.current_price;
	const priceChanged = validation.accepted
		&& typeof previousPrice === 'number'
		&& Math.abs(price - previousPrice) > 0.01;

	let notified = false;
	if (validation.accepted && priceChanged) {
		// Dual write: price_history resta popolata finche' il client non e'
		// migrato sulla vista price_history_v.
		await repo.insertPriceHistory({ product_id: product.id, price });

		const target = product.target_price;
		if (target && price <= target && previousPrice > target) {
			await repo.notifyPriceDrop({ product, oldPrice: previousPrice, newPrice: price });
			notified = true;
		}
	}

	return {
		...outcomeBase,
		offerId: offer.id,
		offerKey: offer.offer_key,
		price,
		previousPrice,
		currency,
		availability,
		confidence,
		confidenceSource: source,
		outcome: validation.outcome,
		accepted: validation.accepted,
		reasons: validation.reasons,
		priceChanged,
		notified,
		health: health.health,
		scrapeError,
	};
}

module.exports = { checkProduct, confidenceOf };
