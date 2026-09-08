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

const { jsonBody } = require('./jsonBody');
const { checkUrl } = require('../scrape/policy/urlPolicy');
const { scrapeProduct, BUDGET_EXCEEDED, DEFAULT_BUDGET_MS } = require('../services/scraper');
const { normalizeScrapeResult } = require('../scrape/normalizeResult');
const { checkProduct } = require('../services/productChecker');
const { createTrackingRepository } = require('../services/trackingRepository');
const { createRecipeStore } = require('../scrape/recipe/store');
const { learnRecipe } = require('../scrape/recipe/learner');
const { describeOffer } = require('../scrape/normalize/offer');

/**
 * Quanto tempo resta allo scrape.
 *
 * Il budget non appartiene al motore ma alla richiesta: e' il tempo che la
 * piattaforma concede prima di troncare la connessione. Va scalato di cio' che
 * e' gia' stato speso in DNS, autenticazione e lettura della ricetta,
 * altrimenti il motore crede di avere tutto il budget quando ne ha meta'.
 *
 * @param {number} startedAt - Date.now() a inizio richiesta
 * @returns {number} millisecondi, mai negativi
 */
function remainingBudget(startedAt) {
	return Math.max(DEFAULT_BUDGET_MS - (Date.now() - startedAt), 1000);
}

/**
 * Risponde a un'analisi che non e' arrivata in fondo nel tempo concesso.
 *
 * E' un 504 nostro, con un motivo leggibile. La sola alternativa e' lasciare
 * che sia il proxy a chiudere la connessione, e in quel caso al client arriva
 * una pagina HTML di errore al posto di JSON: nessun codice, nessun motivo,
 * niente da mostrare all'utente.
 */
function respondBudgetExceeded(res, error) {
	console.warn(`[API] Budget esaurito (${error.reason}), tier 0: ${error.tier0Skipped || 'ok'}`);
	return res.status(504).json({
		error: error.antiBotSuspected
			? 'Il sito ha rifiutato la lettura automatica'
			: 'La pagina ha impiegato troppo tempo a rispondere',
		code: BUDGET_EXCEEDED,
		reason: error.reason,
		antiBotSuspected: Boolean(error.antiBotSuspected),
	});
}

/**
 * La diagnostica di un tentativo, nella forma che serve a chi legge la
 * risposta.
 *
 * Un errore che non dice dove si e' fermato costringe a indovinare, e su un
 * motore che attraversa rete, anti-bot e sei estrattori indipendenti indovinare
 * non e' realistico. Sono tutti dati sul NOSTRO tentativo - quale tier, quanti
 * byte, quali estrattori hanno prodotto qualcosa - non sul contenuto della
 * pagina: non c'e' nulla da proteggere e c'e' tutto da guadagnare.
 */
function describeAttempt(scraped) {
	const debug = scraped?.debug || {};
	return {
		tier: debug.tier ?? null,
		usedBrowser: Boolean(debug.usedBrowser),
		degraded: debug.degraded || null,
		tier0Skipped: debug.tier0Skipped || null,
		htmlBytes: debug.htmlBytes ?? null,
		pageTitle: debug.pageTitle || null,
		extractors: debug.extractors || null,
		totalMs: debug.totalMs ?? null,
	};
}

/**
 * Non si e' riusciti a leggere la pagina fino in fondo.
 *
 * E' diverso da «questa pagina non ha un prezzo», che e' un giudizio
 * definitivo su una pagina che abbiamo visto per intero. Qui non l'abbiamo
 * vista: il browser non e' partito, o il sito ci ha serviato una sfida al suo
 * posto. Dirlo con lo stesso 422 manderebbe l'utente a cercare il problema
 * nell'URL che ha incollato, che e' il posto sbagliato.
 */
function respondIncomplete(res, scraped) {
	const attempt = describeAttempt(scraped);
	console.warn(`[API] Lettura incompleta: ${attempt.degraded}, tier ${attempt.tier}, ${attempt.htmlBytes} byte`);

	return res.status(503).json({
		error: attempt.tier0Skipped?.startsWith('sfida_')
			? 'Il sito ha risposto con una verifica di sicurezza invece della pagina prodotto'
			: 'Non sono riuscito a leggere la pagina fino in fondo',
		code: 'SCRAPE_INCOMPLETE',
		reason: attempt.degraded,
		diagnostics: attempt,
	});
}

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
		// Il body JSON prima di tutto il resto. Su Netlify `express.json()` non
		// lavora - serverless-http consegna una richiesta gia' completa e
		// body-parser la salta - e senza questo passaggio ogni route leggerebbe
		// un Buffer al posto dei suoi campi. Vedi ./jsonBody.js.
		router.use(jsonBody());

		/**
		 * Analizza un URL senza salvarlo. Serve all'anteprima nella UI.
		 */
		router.post('/scrape', async (req, res) => {
			const startedAt = Date.now();
			const { url } = req.body || {};
			try {
				const policy = await checkUrl(url);
				if (!policy.allowed) {
					return res.status(400).json({ error: `URL non ammesso: ${policy.reason}`, reason: policy.reason });
				}
				const data = await scrapeProduct(policy.url, { budgetMs: remainingBudget(startedAt) });
				res.json(normalizeScrapeResult(data, policy.url));
			} catch (error) {
				if (error.code === BUDGET_EXCEEDED) return respondBudgetExceeded(res, error);
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
			const startedAt = Date.now();

			try {
				const policy = await checkUrl(url);
				if (!policy.allowed) {
					return res.status(400).json({ error: `URL non ammesso: ${policy.reason}`, reason: policy.reason });
				}

				const recipes = createRecipeStore({ client });
				const recipe = await recipes.getActiveRecipe(policy.url);
				const scraped = await scrapeProduct(policy.url, { recipe, budgetMs: remainingBudget(startedAt) });
				const data = normalizeScrapeResult(scraped, policy.url);

				// Nessun prezzo leggibile: il prodotto non viene creato. Una storia
				// prezzi che parte da un numero sbagliato non e' recuperabile.
				//
				// Prima pero' bisogna sapere di cosa si sta parlando. Se la lettura
				// e' rimasta a meta' - il browser non e' partito nel budget, oppure
				// il sito ha risposto con una sfida - allora non si e' visto niente,
				// e dire «questa pagina non ha un prezzo» sarebbe un'affermazione
				// che non siamo in grado di fare.
				if (data.priceValue === null) {
					if (scraped.debug?.degraded) return respondIncomplete(res, scraped);

					return res.status(422).json({
						error: 'Nessun prezzo leggibile su quella pagina',
						code: 'LOW_CONFIDENCE',
						confidence: scraped.confidence ?? 0,
						diagnostics: describeAttempt(scraped),
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
				if (error.code === BUDGET_EXCEEDED) return respondBudgetExceeded(res, error);
				console.error('[API] Aggiunta prodotto fallita:', error.message);
				res.status(500).json({ error: 'Aggiunta del prodotto fallita' });
			}
		});

		/**
		 * Aggiorna un prodotto adesso, passando dalla stessa validazione del
		 * controllo automatico.
		 */
		router.post('/products/:id/refresh', async (req, res) => {
			const startedAt = Date.now();
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
					lastResult = await scrapeProduct(url, {
						recipe,
						lastKnownPrice: product.current_price,
						budgetMs: remainingBudget(startedAt),
					});
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
				if (error.code === BUDGET_EXCEEDED) return respondBudgetExceeded(res, error);
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
