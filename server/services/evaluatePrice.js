const { parsePrice } = require('../scrape/normalize/price');
const { normalizeCurrency } = require('../scrape/normalize/currency');
const { normalizeAvailability } = require('../scrape/normalize/availability');
const { describeOffer } = require('../scrape/normalize/offer');
const { validatePrice, OUTCOME, REJECT } = require('../scrape/score/validate');

const cents = value => { const n = parsePrice(value); return n === null ? null : Math.round(n * 100); };
function descriptorOf(scraped, url) {
	return describeOffer({ ...scraped?.details, ...scraped?.offer, sku: scraped?.sku ?? scraped?.offer?.sku, gtin: scraped?.gtin ?? scraped?.offer?.gtin }, url);
}
function evaluatePrice({ scraped, product = {}, history = [], knownOffer = null, confirmed = false }) {
	const price = parsePrice(scraped?.priceValue ?? scraped?.price);
	const currency = normalizeCurrency(scraped?.currency ?? scraped?.price, { url: product.url, fallback: null });
	const availability = normalizeAvailability(scraped?.availability ?? scraped?.available);
	const confidence = Number.isFinite(scraped?.confidence) ? scraped.confidence : 0;
	const descriptor = descriptorOf(scraped, product.url);
	const previous = parsePrice(product.current_price);
	const reference = history.length ? history : previous === null ? [] : [{ price: previous, observedAt: product.last_success_at || new Date().toISOString() }];
	const validation = validatePrice({ price, currency, availability, confidence,
		identity: descriptor, knownIdentity: product, knownCurrency: product.currency, history: reference, confirmed });
	const problems = [];
	if (!currency) problems.push('valuta_non_verificata');
	if (previous === null && !history.length && confidence < 0.85) problems.push(REJECT.LOW_CONFIDENCE);
	if (scraped?.fields?.price?.meta?.isRange || scraped?.priceStatus) problems.push('offerta_ambigua');
	if (scraped?.debug?.degraded) problems.push('lettura_incompleta');
	if (knownOffer) {
		for (const key of ['seller', 'condition']) {
			if (knownOffer[key] && (!descriptor[key] || knownOffer[key].toLowerCase().trim() !== descriptor[key].toLowerCase().trim())) problems.push(REJECT.IDENTITY_CHANGED);
		}
		for (const [key, value] of Object.entries(knownOffer.variant || {})) {
			if (String(descriptor.variant[key] ?? '').toLowerCase() !== String(value).toLowerCase()) problems.push(REJECT.IDENTITY_CHANGED);
		}
	}
	// Once an identifier is pinned, losing it is not proof of the same product.
	for (const key of ['sku', 'gtin']) if (product[key] && !descriptor[key]) problems.push(REJECT.IDENTITY_CHANGED);
	if (problems.length) Object.assign(validation, { accepted: false, outcome: OUTCOME.QUARANTINED, reasons: [...new Set([...validation.reasons, ...problems])] });
	return { price, currency, availability, confidence, descriptor, validation };
}
module.exports = { evaluatePrice, descriptorOf, cents };
