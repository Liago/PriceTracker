const { createClient } = require('@supabase/supabase-js');

/**
 * Client amministrativo, creato al primo uso e non al require.
 *
 * Crearlo a livello di modulo faceva fallire il caricamento di CHIUNQUE
 * importasse questo file quando le variabili d'ambiente non erano ancora
 * disponibili - inclusa la function api, che importa priceTracker solo per un
 * endpoint di comodo. Un modulo non deve rendere impossibile il caricamento di
 * chi lo importa.
 */
let supabaseAdminInstance = null;
function admin() {
	if (!supabaseAdminInstance) {
		const url = process.env.SUPABASE_URL;
		const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
		if (!url || !key) {
			throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono necessarie per il controllo prezzi');
		}
		supabaseAdminInstance = createClient(url, key);
	}
	return supabaseAdminInstance;
}

const { normalizeUserSettings } = require('./userSettings');
const { checkProduct } = require('./productChecker');
const { createTrackingRepository } = require('./trackingRepository');
const { createRecipeStore } = require('../scrape/recipe/store');
const { learnRecipe } = require('../scrape/recipe/learner');

async function getUserSettings(userId) {
	const { data, error } = await admin()
		.from('user_settings')
		.select('*')
		.eq('user_id', userId)
		.single();

	if (error) {
		console.warn(`[Price Tracker] Impossibile leggere le impostazioni di ${userId}, uso i default:`, error.message);
	}

	return normalizeUserSettings(error ? null : data);
}

const { scrapeProduct } = require('./scraper');

async function checkProductPrices() {
	console.log('[Price Tracker] Starting price check...');

	const supabaseAdmin = admin();
	const repo = createTrackingRepository(supabaseAdmin);
	const recipes = createRecipeStore({ client: supabaseAdmin });

	try {
		// Fetch all active products (monitoring_until is null or in the future)
		const { data: products, error } = await supabaseAdmin
			.from('products')
			.select('*')
			.or('monitoring_until.is.null,monitoring_until.gte.' + new Date().toISOString().split('T')[0]);

		if (error) {
			console.error('[Price Tracker] Error fetching products:', error);
			return;
		}

		if (!products || products.length === 0) {
			console.log('[Price Tracker] No active products to check');
			return;
		}

		console.log(`[Price Tracker] Checking ${products.length} products...`);

		// Group products by user to fetch settings once per user
		const userProducts = {};
		for (const product of products) {
			if (!userProducts[product.user_id]) {
				userProducts[product.user_id] = [];
			}
			userProducts[product.user_id].push(product);
		}

		for (const [userId, userProductList] of Object.entries(userProducts)) {
			// Fetch user settings
			const userSettings = await getUserSettings(userId);
			const intervalMinutes = userSettings.priceCheckIntervalMinutes;

			for (const product of userProductList) {
				try {
					// E' il momento di controllare questo prodotto?
					const lastChecked = product.last_checked_at ? new Date(product.last_checked_at) : new Date(0);
					const nextCheck = new Date(lastChecked.getTime() + intervalMinutes * 60000);
					if (new Date() < nextCheck) continue;

					console.log(`[Price Tracker] Controllo: ${product.name}`);

					// Ricetta attiva del dominio: se c'e', lo scrape prende il fast
					// path e salta la scoperta completa.
					const recipe = await recipes.getActiveRecipe(product.url);

					let lastResult = null;
					const scrape = async (url) => {
						lastResult = await scrapeProduct(url, {
							recipe,
							lastKnownPrice: product.current_price ?? null,
						});
						return lastResult;
					};

					// La decisione sta in productChecker, la scrittura nel repository.
					// Qui resta solo l'orchestrazione.
					const outcome = await checkProduct({ product, scrape, repo });

					// Il ciclo di apprendimento: la ricetta guadagna o perde
					// credito a seconda di come e' andata, e una scoperta
					// riuscita su un dominio senza ricetta ne genera una.
					if (recipe) {
						await recipes.recordOutcome(recipe, outcome.accepted);
					} else if (outcome.accepted && lastResult) {
						const { recipe: learned } = learnRecipe(lastResult, { url: product.url });
						if (learned) {
							const { saved } = await recipes.saveLearnedRecipe(learned);
							if (saved) {
								console.log(`[Price Tracker] Ricetta appresa per ${learned.domain} (v${saved.version})`);
							}
						}
					}

					if (outcome.accepted) {
						console.log(
							`[Price Tracker] ${product.name}: ${outcome.price} ${outcome.currency}` +
							`${outcome.priceChanged ? ` (era ${outcome.previousPrice})` : ' (invariato)'}`
						);
					} else {
						// Un prezzo rifiutato non e' un silenzio: e' registrato come
						// osservazione e visibile nello stato di salute del prodotto.
						console.warn(
							`[Price Tracker] ${product.name}: prezzo NON accettato ` +
							`(${outcome.reasons.join(', ')}), salute: ${outcome.health}`
						);
					}

					// Delay between requests to avoid rate limiting (use user settings)
					await new Promise(resolve => setTimeout(resolve, userSettings.scrapeDelayMs));

				} catch (error) {
					// checkProduct gestisce gia' i fallimenti di scrape e li
					// registra. Qui si finisce solo per errori di persistenza,
					// che non devono fermare gli altri prodotti.
					console.error(`[Price Tracker] Errore sul prodotto ${product.id}:`, error.message);
				}
			}
		}

		console.log('[Price Tracker] Price check completed');
	} catch (error) {
		console.error('[Price Tracker] Fatal error:', error);
	}
}

module.exports = { checkProductPrices };
