/**
 * Route dell'applicazione, condivise fra il server Express e la function
 * Netlify.
 *
 * Finora le due copie divergevano - stessa logica scritta due volte, con
 * comportamenti diversi sul parsing del body. Definirle una volta sola elimina
 * la classe di problemi.
 *
 * Il punto piu' importante e' che aggiunta e aggiornamento di un prodotto
 * passano da qui e non piu' dal client (difetto D15): finora il client
 * scriveva su products e price_history con la chiave anonima, in parallelo al
 * server, senza validazione. Il prezzo che entra nella storia lo decide il
 * motore, non il browser dell'utente.
 */

const { checkUrl } = require('../scrape/policy/urlPolicy');
const { scrapeProduct } = require('../services/scraper');
const { normalizeScrapeResult } = require('../scrape/normalizeResult');
const { checkProduct } = require('../services/productChecker');
const { createTrackingRepository } = require('../services/trackingRepository');
const { createRecipeStore } = require('../scrape/recipe/store');
const { learnRecipe } = require('../scrape/recipe/learner');
const { describeOffer } = require('../scrape/normalize/offer');

/**
 * Estrae l'utente dal token di sessione Supabase.
 * @returns {Promise<{user: object|null, error: string|null}>}
 */
async function authenticate(req, client) {
	const header = req.headers.authorization || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : null;
	if (!token) return { user: null, error: 'token mancante' };

	const { data, error } = await client.auth.getUser(token);
	if (error || !data?.user) return { user: null, error: 'sessione non valida' };
	return { user: data.user, error: null };
}

/**
 * @param {object} deps
 * @param {function} deps.getClient - () => client Supabase service_role
 * @returns {function} (router) => void
 */
function registerRoutes({ getClient }) {
	return function attach(router) {
		/**
		 * Analizza un URL senza salvarlo. Serve all'anteprima nella UI.
		 */
		router.post('/scrape', async (req, res) => {
			const { url } = req.body || {};
			try {
				const policy = await checkUrl(url);
				if (!policy.allowed) {
					return res.status(400).json({ error: `URL non ammesso: ${policy.reason}`, reason: policy.reason });
				}
				const data = await scrapeProduct(policy.url);
				res.json(normalizeScrapeResult(data, policy.url));
			} catch (error) {
				console.error('[API] Errore di scrape:', error.message);
				res.status(500).json({ error: 'Analisi della pagina fallita' });
			}
		});

		/**
		 * Aggiunge un prodotto. La scrittura avviene qui, non nel client.
		 */
		router.post('/products', async (req, res) => {
			const client = getClient();
			const { user, error: authError } = await authenticate(req, client);
			if (!user) return res.status(401).json({ error: authError });

			const { url, targetPrice = null, monitoringUntil = null } = req.body || {};

			try {
				const policy = await checkUrl(url);
				if (!policy.allowed) {
					return res.status(400).json({ error: `URL non ammesso: ${policy.reason}`, reason: policy.reason });
				}

				const recipes = createRecipeStore({ client });
				const recipe = await recipes.getActiveRecipe(policy.url);
				const scraped = await scrapeProduct(policy.url, { recipe });
				const data = normalizeScrapeResult(scraped, policy.url);

				// Nessun prezzo leggibile: il prodotto non viene creato. Una storia
				// prezzi che parte da un numero sbagliato non e' recuperabile.
				if (data.priceValue === null) {
					return res.status(422).json({
						error: 'Nessun prezzo leggibile su quella pagina',
						code: 'LOW_CONFIDENCE',
						confidence: scraped.confidence ?? 0,
					});
				}

				const domain = new URL(policy.url).hostname.replace(/^www\./, '').toLowerCase();
				const { data: product, error: insertError } = await client
					.from('products')
					.insert({
						user_id: user.id,
						url: policy.url,
						canonical_url: scraped.canonicalUrl || policy.url,
						domain,
						name: data.title,
						image: data.image,
						description: data.description,
						current_price: data.priceValue,
						currency: data.currency,
						availability: data.availability,
						target_price: targetPrice,
						monitoring_until: monitoringUntil,
						store: data.store,
						brand: scraped.brand ?? null,
						sku: scraped.sku ?? null,
						gtin: scraped.gtin ?? null,
						details: data.details || {},
						tracking_health: 'healthy',
						last_success_at: new Date().toISOString(),
					})
					.select()
					.single();

				if (insertError) throw new Error(insertError.message);

				// Offerta e prima osservazione: la serie storica parte da qui.
				const descriptor = scraped.offer || describeOffer(data, policy.url);
				const { data: offer } = await client.from('product_offers').insert({
					product_id: product.id,
					offer_key: descriptor.offerKey,
					variant: descriptor.variant || {},
					seller: descriptor.seller,
					condition: descriptor.condition,
					url: descriptor.url || policy.url,
					is_primary: true,
					current_price: data.priceValue,
					currency: data.currency,
					availability: data.availability,
					last_seen_at: new Date().toISOString(),
				}).select().single();

				if (offer) {
					await client.from('products').update({ primary_offer_id: offer.id }).eq('id', product.id);
					await client.from('price_observations').insert({
						product_id: product.id,
						offer_id: offer.id,
						price: data.priceValue,
						currency: data.currency,
						availability: data.availability,
						confidence: scraped.confidence ?? null,
						accepted: true,
					});
				}

				// Un dominio nuovo che si legge bene produce subito una ricetta.
				if (!recipe && scraped.fields) {
					const { recipe: learned } = learnRecipe(scraped, { url: policy.url });
					if (learned) await recipes.saveLearnedRecipe(learned);
				}

				res.status(201).json({ product, confidence: scraped.confidence ?? null });
			} catch (error) {
				console.error('[API] Aggiunta prodotto fallita:', error.message);
				res.status(500).json({ error: 'Aggiunta del prodotto fallita' });
			}
		});

		/**
		 * Aggiorna un prodotto adesso, passando dalla stessa validazione del
		 * controllo automatico.
		 */
		router.post('/products/:id/refresh', async (req, res) => {
			const client = getClient();
			const { user } = await authenticate(req, client);
			if (!user) return res.status(401).json({ error: 'sessione non valida' });

			try {
				const { data: product, error } = await client
					.from('products').select('*').eq('id', req.params.id).eq('user_id', user.id).maybeSingle();

				if (error || !product) return res.status(404).json({ error: 'Prodotto non trovato' });

				const recipes = createRecipeStore({ client });
				const recipe = await recipes.getActiveRecipe(product.url);
				const repo = createTrackingRepository(client);

				let lastResult = null;
				const scrape = async (url) => {
					lastResult = await scrapeProduct(url, { recipe, lastKnownPrice: product.current_price });
					return lastResult;
				};

				const outcome = await checkProduct({ product, scrape, repo });
				if (recipe) await recipes.recordOutcome(recipe, outcome.accepted);

				res.json({
					accepted: outcome.accepted,
					price: outcome.price,
					previousPrice: outcome.previousPrice,
					currency: outcome.currency,
					availability: outcome.availability,
					confidence: outcome.confidence,
					health: outcome.health,
					reasons: outcome.reasons,
					priceChanged: outcome.priceChanged,
				});
			} catch (error) {
				console.error('[API] Refresh fallito:', error.message);
				res.status(500).json({ error: 'Aggiornamento fallito' });
			}
		});

		/**
		 * Stato di salute del tracking, con l'ultimo esito e il motivo.
		 */
		router.get('/products/:id/health', async (req, res) => {
			const client = getClient();
			const { user } = await authenticate(req, client);
			if (!user) return res.status(401).json({ error: 'sessione non valida' });

			try {
				const { data: product } = await client
					.from('products')
					.select('id, tracking_health, consecutive_failures, last_checked_at, last_success_at, availability')
					.eq('id', req.params.id).eq('user_id', user.id).maybeSingle();

				if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

				const { data: observations } = await client
					.from('price_observations')
					.select('price, accepted, reject_reason, confidence, observed_at')
					.eq('product_id', req.params.id)
					.order('observed_at', { ascending: false })
					.limit(10);

				res.json({ ...product, recentObservations: observations || [] });
			} catch (error) {
				res.status(500).json({ error: 'Lettura dello stato fallita' });
			}
		});

		/**
		 * Segnalazione di un campo estratto male.
		 */
		router.post('/feedback', async (req, res) => {
			const client = getClient();
			const { user } = await authenticate(req, client);
			if (!user) return res.status(401).json({ error: 'sessione non valida' });

			const { productId = null, field, reported, expectedValue = null } = req.body || {};

			if (!['price', 'currency', 'title', 'image', 'availability'].includes(field)) {
				return res.status(400).json({ error: 'campo non valido' });
			}
			if (!['wrong', 'missing', 'correct'].includes(reported)) {
				return res.status(400).json({ error: 'segnalazione non valida' });
			}

			try {
				let domain = 'sconosciuto';
				if (productId) {
					const { data: product } = await client
						.from('products').select('domain, url').eq('id', productId).eq('user_id', user.id).maybeSingle();
					if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });
					domain = product.domain || new URL(product.url).hostname.replace(/^www\./, '');
				}

				const { error } = await client.from('scrape_field_feedback').insert({
					user_id: user.id, product_id: productId, domain, field, reported, expected_value: expectedValue,
				});
				if (error) throw new Error(error.message);

				// Una segnalazione di errore mette in dubbio la ricetta attiva: la
				// si manda in quarantena, cosi' il prossimo controllo rifa' la
				// scoperta invece di ripetere lo stesso errore.
				if (reported === 'wrong' && productId) {
					const recipes = createRecipeStore({ client });
					const { data: product } = await client.from('products').select('url').eq('id', productId).maybeSingle();
					const recipe = product ? await recipes.getActiveRecipe(product.url) : null;
					if (recipe) {
						await client.from('scrape_recipes')
							.update({ status: 'quarantined', updated_at: new Date().toISOString() })
							.eq('id', recipe.id);
					}
				}

				res.status(201).json({ ok: true });
			} catch (error) {
				console.error('[API] Segnalazione fallita:', error.message);
				res.status(500).json({ error: 'Registrazione della segnalazione fallita' });
			}
		});

		/**
		 * Stato dei domini: sostituisce la pagina "domini supportati", che non ha
		 * piu' senso ora che non esiste una whitelist.
		 */
		router.get('/domains', async (req, res) => {
			const client = getClient();
			const { user } = await authenticate(req, client);
			if (!user) return res.status(401).json({ error: 'sessione non valida' });

			try {
				const { data } = await client
					.from('domain_profiles_public')
					.select('domain, platform, anti_bot, block_reason, blocked_until, success_count, failure_count, last_success_at')
					.order('domain');
				res.json({ domains: data || [] });
			} catch (error) {
				res.status(500).json({ error: 'Lettura dei domini fallita' });
			}
		});
	};
}

module.exports = { registerRoutes, authenticate };
