/**
 * Validation utilities for the Price Tracker application.
 */

// Whitelisted domains for scraping
const ALLOWED_DOMAINS = [
	'amazon.it',
	'amazon.com',
	'amazon.co.uk',
	'amazon.de',
	'amazon.fr',
	'amazon.es',
	'www.amazon.it',
	'www.amazon.com',
	'www.amazon.co.uk',
	'www.amazon.de',
	'www.amazon.fr',
	'www.amazon.es',
	'swappie.com',
	'www.swappie.com'
];

/**
 * Validates if a given URL is a supported product URL.
 * @param {string} urlString - The URL to validate.
 * @returns {string} - The clean, validated URL.
 * @throws {Error} - If the URL is invalid or not supported.
 */
function validateProductUrl(urlString) {
	if (!urlString || typeof urlString !== 'string') {
		throw new Error('URL must be a non-empty string');
	}

	let url;
	try {
		url = new URL(urlString);
	} catch (e) {
		throw new Error('Invalid URL format');
	}

	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error('URL must use HTTP or HTTPS protocol');
	}

	if (!ALLOWED_DOMAINS.includes(url.hostname)) {
		throw new Error(`Domain '${url.hostname}' is not supported. Supported domains: Amazon, Swappie.`);
	}

	return url.toString();
}

/**
 * Sanitizes generic text input.
 * @param {string} text 
 * @returns {string}
 */
function sanitizeInput(text) {
	if (typeof text !== 'string') return text;
	// Basic sanitization: remove potential HTML tags (very basic)
	return text.replace(/<[^>]*>/g, '');
}

module.exports = {
	validateProductUrl,
	sanitizeInput
};
