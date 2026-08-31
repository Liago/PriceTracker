/**
 * Ricette seminate: i tredici scraper dedicati, espressi come dati.
 *
 * Questo modulo e' la forma leggibile e verificabile di cio' che la migrazione
 * 006 inserisce a database. Serve a due cose: documentare la conversione, e
 * permettere ai test di esercitare le ricette seminate contro le fixture -
 * cioe' di verificare che producano lo stesso risultato della classe che
 * sostituiscono, che e' il criterio di uscita della fase 3.
 *
 * Criterio di sicurezza. Si usano solo strategie auto-validanti: jsonld,
 * microdata e meta non inventano nulla quando la pagina non le espone, e il
 * motore ripiega da solo sulla scoperta. I selettori CSS trascritti a mano
 * dagli scraper - non verificabili contro pagine reali da qui - entrano solo
 * come fallback.
 */

/** Dieci scraper su tredici leggono gia' il JSON-LD. */
const STRUCTURED_FIELDS = Object.freeze({
	price: {
		strategy: 'jsonld',
		fallbacks: [
			{ strategy: 'microdata', selector: '[itemprop="price"]', attr: 'content' },
			{ strategy: 'meta', key: 'product:price:amount' },
		],
	},
	currency: { strategy: 'jsonld' },
	availability: { strategy: 'jsonld' },
	title: { strategy: 'jsonld' },
	image: { strategy: 'jsonld' },
	sku: { strategy: 'jsonld' },
	brand: { strategy: 'jsonld' },
});

/** Amazon non espone un JSON-LD Product utilizzabile. */
const AMAZON_FIELDS = Object.freeze({
	price: {
		strategy: 'jsonld',
		fallbacks: [
			{ strategy: 'meta', key: 'product:price:amount' },
			{ strategy: 'css', selector: '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', attr: null },
			{ strategy: 'css', selector: '.apexPriceToPay .a-offscreen', attr: null },
			{ strategy: 'css', selector: '.a-price .a-offscreen', attr: null },
		],
	},
	title: {
		strategy: 'css', selector: '#productTitle', attr: null,
		fallbacks: [{ strategy: 'meta', key: 'og:title' }],
	},
	image: {
		strategy: 'meta', key: 'og:image',
		fallbacks: [{ strategy: 'css', selector: '#landingImage', attr: 'src' }],
	},
	currency: { strategy: 'meta', key: 'product:price:currency' },
});

/** Swappie e Rework Labs si appoggiano ai meta Open Graph. */
const OG_FIELDS = Object.freeze({
	price: {
		strategy: 'meta', key: 'product:price:amount',
		fallbacks: [{ strategy: 'jsonld' }],
	},
	currency: { strategy: 'meta', key: 'product:price:currency' },
	title: { strategy: 'meta', key: 'og:title' },
	image: { strategy: 'meta', key: 'og:image' },
});

const STRUCTURED_DOMAINS = [
	'mediaworld.it', 'unieuro.it', 'eprice.it', 'ebay.it', 'zalando.it',
	'backmarket.it', 'refurbed.it', 'juice.it', 'smartgeneration.it', 'aliexpress.com',
];

const AMAZON_DOMAINS = ['amazon.it', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es'];

const OG_DOMAINS = ['swappie.com', 'rework-labs.com'];

const build = (domains, fields, confidence) => domains.map((domain) => ({
	domain,
	url_pattern: '*',
	scope: 'domain',
	version: 1,
	status: 'active',
	origin: 'seeded',
	transport: 'browser',
	fields,
	confidence,
}));

const SEEDED_RECIPES = Object.freeze([
	...build(STRUCTURED_DOMAINS, STRUCTURED_FIELDS, 0.9),
	...build(AMAZON_DOMAINS, AMAZON_FIELDS, 0.8),
	...build(OG_DOMAINS, OG_FIELDS, 0.7),
]);

/** @returns {object|undefined} */
function seedFor(domain) {
	return SEEDED_RECIPES.find((recipe) => recipe.domain === domain);
}

module.exports = {
	SEEDED_RECIPES,
	seedFor,
	STRUCTURED_FIELDS,
	AMAZON_FIELDS,
	OG_FIELDS,
	STRUCTURED_DOMAINS,
	AMAZON_DOMAINS,
	OG_DOMAINS,
};
