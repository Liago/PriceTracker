const { randomUUID } = require('crypto');
const { evaluatePrice, descriptorOf, cents } = require('./evaluatePrice');
const { nextTrackingHealth, OUTCOME, REJECT } = require('../scrape/score/validate');
const { recordCheck } = require('../scrape/telemetry');
function confidenceOf(scraped) {
	return { confidence: Number.isFinite(scraped?.confidence) ? scraped.confidence : 0, source: scraped?.fields?.price?.source ?? 'pipeline' };
}
/** La lettura precedente diceva gia' lo stesso prezzo, respinto solo perche' da confermare? */
function confirmedOverTime(reading, recent = []) {
	const last = (recent || [])[0];
	if (!last || last.accepted || last.price == null || reading.price == null) return false;
	const reasons = String(last.rejectReason || '').split(',').filter(Boolean);
	if (!reasons.length || reasons.some(reason => reason !== REJECT.DELTA_IMPLAUSIBLE)) return false;
	return cents(last.price) === cents(reading.price) && (!last.currency || last.currency === reading.currency);
}
async function checkProduct({ product, scrape, repo, now = () => new Date() }) {
	const startedAt = now();
	let scraped = null, scrapeError = null, blocked = false, diagnostics = null;
	try { scraped = await scrape(product.url); } catch (error) {
		diagnostics = { reason: error.reason || null, code: error.code || null, tier: error.tier ?? null,
			tier0Skipped: error.tier0Skipped || null, antiBotSuspected: Boolean(error.antiBotSuspected),
			totalMs: error.totalMs ?? null, ...error.evidence };
		scrapeError = [error.reason, error.message || String(error)].filter(Boolean).join(': ');
		const budgetFailure = ['budget_insufficiente', 'budget_esaurito', 'budget_speso_nell_avvio', 'navigazione_troncata', 'browser_fallito'].includes(error.reason);
		blocked = !budgetFailure && Boolean(error.reason === 'pagina_di_sfida' || error.antiBotSuspected || error.reason?.startsWith('sfida_') || error.message?.includes('CAPTCHA'));
	}
	const reference = await repo.getReference(product);
	let reading = evaluatePrice({ scraped, product, history: reference.history, knownOffer: reference.offer });
	if (scrapeError) Object.assign(reading.validation, { accepted: false, outcome: OUTCOME.QUARANTINED, reasons: [blocked ? 'sito_bloccato' : diagnostics?.reason || 'errore_di_scrape'] });
	if (reading.validation.outcome === OUTCOME.NEEDS_CONFIRMATION) {
		try {
			const second = await scrape(product.url, { confirmation: true });
			const secondReading = evaluatePrice({ scraped: second, product, history: reference.history, knownOffer: reference.offer, confirmed: true });
			const source = confidenceOf(scraped).source, secondSource = confidenceOf(second).source;
			const independent = secondSource !== source && !['dom', 'recipe', 'pipeline'].includes(secondSource);
			if (independent && cents(secondReading.price) === cents(reading.price) && secondReading.currency === reading.currency
				&& secondReading.descriptor.offerKey === reading.descriptor.offerKey && secondReading.confidence >= 0.85 && secondReading.validation.accepted) {
				reading = secondReading; scraped = second;
			}
		} catch { /* Keep a rejected observation; never replace the last good price. */ }
	}
	// Conferma nel tempo. La seconda lettura nello stesso controllo rilegge la
	// stessa fonte e quasi mai risulta «indipendente», e lo storico di
	// riferimento contiene solo prezzi accettati: un cambio vero oltre la soglia
	// restava respinto per sempre. Lo stesso prezzo, stessa valuta e stessa
	// offerta, gia' letto e respinto solo per la variazione al controllo
	// precedente, e' la conferma che mancava.
	if (reading.validation.outcome === OUTCOME.NEEDS_CONFIRMATION && confirmedOverTime(reading, reference.recent)) {
		const confirmedReading = evaluatePrice({ scraped, product, history: reference.history, knownOffer: reference.offer, confirmed: true });
		if (confirmedReading.validation.accepted) reading = confirmedReading;
	}
	const { price, currency, availability, confidence, validation } = reading;
	// A failed scrape retains the pinned offer; it must not invent a new default offer.
	const descriptor = scrapeError && reference.offer ? { ...reference.offer, offerKey: reference.offer.offer_key } : descriptorOf(scraped, product.url);
	const health = nextTrackingHealth({ outcome: validation.outcome, consecutiveFailures: product.consecutive_failures ?? 0,
		identityChanged: validation.reasons.includes(REJECT.IDENTITY_CHANGED), blocked });
	const patch = { last_checked_at: startedAt.toISOString(), tracking_health: health.health, consecutive_failures: health.consecutiveFailures };
	if (availability !== 'unknown' && !validation.reasons.includes(REJECT.IDENTITY_CHANGED)) patch.availability = availability;
	const previousPrice = product.current_price == null ? null : Number(product.current_price);
	const priceChanged = validation.accepted && cents(previousPrice) !== cents(price);
	if (validation.accepted) Object.assign(patch, { current_price: price, last_success_at: startedAt.toISOString(), currency,
		...(priceChanged ? { last_price_change_at: startedAt.toISOString() } : {}),
		...(!product.sku && descriptor.sku ? { sku: descriptor.sku } : {}),
		...(!product.gtin && descriptor.gtin ? { gtin: descriptor.gtin } : {}) });
	const result = await repo.commitCheck({ product, descriptor, patch,
		observation: { id: randomUUID(), product_id: product.id, price, currency, availability, confidence, accepted: validation.accepted,
			reject_reason: validation.accepted ? null : validation.reasons.join(','), observed_at: startedAt.toISOString() },
		run: { url: product.url, domain: product.domain || new URL(product.url).hostname.replace(/^www\./, ''),
			status: blocked ? 'blocked' : validation.accepted ? 'success' : 'quarantined',
			duration_ms: Math.max(0, Date.now() - startedAt.getTime()), winning_source: confidenceOf(scraped).source,
			confidence, validation, error_message: scrapeError,
			result: { price, currency, availability, offer: descriptor, diagnostics: diagnostics || scraped?.debug || null }, extractors_ran: scraped?.extractorsRan || [],
			candidates: (scraped?.candidates || []).map(({ field, value, source, path, weight }) => ({ field, value, source, path, weight })) } });
	recordCheck({ domain: product.domain, accepted: validation.accepted, confidence, source: confidenceOf(scraped).source, durationMs: Date.now() - startedAt.getTime(), reasons: validation.reasons });
	return { productId: product.id, price, previousPrice, currency, availability, confidence, confidenceSource: confidenceOf(scraped).source,
		accepted: validation.accepted, outcome: validation.outcome, reasons: validation.reasons, health: health.health,
		priceChanged: result.priceChanged, notified: result.notified, offerId: result.offerId, offerKey: descriptor.offerKey, scrapeError, diagnostics };
}
module.exports = { checkProduct, confidenceOf, confirmedOverTime };
