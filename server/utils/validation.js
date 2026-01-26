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
	'www.swappie.com',
	'refurbed.it',
	'www.refurbed.it',
	'rework-labs.com',
	'www.rework-labs.com',
	'smartgeneration.it',
	'www.smartgeneration.it',
	'juice.it',
	'www.juice.it',
	'ebay.it',
	'www.ebay.it',
	'mediaworld.it',
	'www.mediaworld.it'
];


const { createClient } = require('@supabase/supabase-js');

let supabase;

function getSupabase() {
	if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
		supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
	}
	return supabase;
}

/**
 * Validates if a given URL is a supported product URL.
 * @param {string} urlString - The URL to validate.
 * @returns {Promise<string>} - The clean, validated URL.
 * @throws {Error} - If the URL is invalid or not supported.
 */
async function validateProductUrl(urlString) {
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

	let allowedDomains = ALLOWED_DOMAINS;
	const client = getSupabase();

	if (client) {
		try {
			const { data, error } = await client
				.from('supported_domains')
				.select('domain');

			if (!error && data && data.length > 0) {
				// Merge DB domains with hardcoded fallback to ensure base support works
				const dbDomains = data.map(d => d.domain);
				allowedDomains = [...new Set([...allowedDomains, ...dbDomains])];
			}
		} catch (err) {
			console.warn('Failed to fetch supported domains from DB, using fallback:', err.message);
		}
	}

	if (!allowedDomains.includes(url.hostname)) {
		throw new Error(`Domain '${url.hostname}' is not supported.`);
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
