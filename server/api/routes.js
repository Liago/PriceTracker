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
		// `reason` e' il campo che si guarda per primo, quindi porta il motivo
		// piu' specifico disponibile invece di lasciarlo dedurre dagli altri.
		reason: debug.degraded || debug.tier0Skipped || null,
		degraded: debug.degraded || null,
		tier0Skipped: debug.tier0Skipped || null,
		htmlBytes: debug.htmlBytes ?? null,
		pageTitle: debug.pageTitle || null,
		httpStatus: debug.httpStatus ?? null,
		navigationTimedOut: debug.navigationTimedOut ?? null,
		extractors: debug.extractors || null,
		totalMs: debug.totalMs ?? null,
	};
}

/**
 * Come si racconta un tentativo che non e' arrivato in fondo.
 *
 * Ogni voce e' una diagnosi diversa e porta a un'azione diversa: confonderle
 * dentro un unico «non riuscito» costringe chi legge a indovinare quale delle
 * tre stia guardando.
 */
const FAILURES = Object.freeze({
	pagina_di_sfida: {
		status: 503,
		message: 'Il sito ha risposto con una verifica di sicurezza invece della pagina prodotto',
	},
	navigazione_troncata: {
		status: 504,
		message: 'La pagina non ha finito di caricarsi nel tempo disponibile',
	},
	budget_esaurito: {
		status: 504,
		message: 'La pagina ha impiegato troppo tempo a rispondere',
	},
	// Il sito non e' stato contattato affatto: dargli la colpa della lentezza
	// sarebbe un'affermazione su qualcosa che non e' mai successo. Il 503 dice
	// che il servizio non era in condizione di provarci, ed e' la verita'.
	budget_insufficiente: {
		status: 503,
		message: "Non c'era tempo per leggere la pagina: il servizio è configurato con un budget troppo stretto",
	},
	budget_speso_nell_avvio: {
		status: 504,
		message: "L'avvio del browser ha consumato il tempo disponibile prima di poter caricare la pagina",
	},
	nessun_candidato: {
		status: 502,
		message: 'Il sito ha risposto, ma con una pagina vuota',
	},
	pagina_troppo_piccola: {
		status: 502,
		message: 'Il sito ha risposto, ma con una pagina vuota',
	},
});

const DEFAULT_FAILURE = { status: 503, message: 'Non sono riuscito a leggere la pagina fino in fondo' };

/** Il blocco a cui appartiene un motivo, tollerando i suffissi tipo `sfida_datadome`. */
function classifyFailure(reason, antiBotSuspected) {
	if (reason && FAILURES[reason]) return FAILURES[reason];
	if (reason?.startsWith('sfida_') || reason?.startsWith('bloccato_dal_sito') || antiBotSuspected) {
		return FAILURES.pagina_di_sfida;
	}
	return DEFAULT_FAILURE;
}

/**
 * Risponde a una lettura che non e' arrivata in fondo.
 *
 * E' diverso da «questa pagina non ha un prezzo», che e' un giudizio
 * definitivo su una pagina vista per intero. Qui non l'abbiamo vista: il
 * browser non e' partito, la navigazione si e' fermata a meta', o il sito ha
 * servito una sfida al suo posto. Dirlo con lo stesso 422 manda l'utente a
 * cercare il problema nell'URL che ha incollato, che e' il posto sbagliato.
 */
function respondIncomplete(res, { scraped = null, error = null }) {
	const attempt = scraped ? describeAttempt(scraped) : describeError(error);
	const failure = classifyFailure(attempt.reason, attempt.antiBotSuspected);

	console.warn(
		`[API] Lettura incompleta (${attempt.reason}): tier ${attempt.tier}, ${attempt.htmlBytes} byte in ${attempt.totalMs}ms`
		+ (attempt.suggestedBudgetMs ? ` - servirebbe SCRAPE_REQUEST_BUDGET_MS=${attempt.suggestedBudgetMs}` : ''),
	);

	return res.status(failure.status).json({
		error: failure.message,
		code: 'SCRAPE_INCOMPLETE',
		reason: attempt.reason,
		diagnostics: attempt,
	});
}

/**
 * La diagnostica di un tentativo che si e' concluso con un'eccezione.
 *
 * Il tier arriva dal motore, che lo traccia mentre accade. Dedurlo qui - come
 * faceva la prima versione, guardando se c'erano byte di HTML - produceva
 * diagnostiche che dichiaravano «tier 0» su tentativi in cui il browser era
 * partito e aveva perfino riconosciuto una sfida: la cosa peggiore che possa
 * fare un campo diagnostico, cioe' mentire con sicurezza.
 */
function describeError(error) {
	const evidence = error?.evidence || {};
	return {
		tier: error?.tier ?? 0,
		usedBrowser: (error?.tier ?? 0) === 1,
		reason: error?.reason || null,
		tier0Skipped: error?.tier0Skipped || null,
		antiBotSuspected: Boolean(error?.antiBotSuspected),
		htmlBytes: evidence.htmlBytes ?? null,
		pageTitle: evidence.pageTitle || null,
		httpStatus: evidence.httpStatus ?? null,
		navigationTimedOut: evidence.navigationTimedOut ?? null,
		navigationTimeoutMs: evidence.navigationTimeoutMs ?? null,
		browserStartMs: evidence.browserStartMs ?? null,
		// Quale sfida ci ha fermati: senza il nome del fornitore non si sa se
		// il caso è affrontabile (un JS challenge che si risolve aspettando) o
		// se è un blocco per indirizzo, dove nessuna regolazione aiuta.
		challengeType: evidence.challengeType || null,
		challengeIndicators: evidence.challengeIndicators || null,
		// Quando il motore sa quanto budget gli sarebbe servito, lo dice: e' un
		// numero osservato, ed e' esattamente cio' che va in configurazione.
		suggestedBudgetMs: evidence.suggestedBudgetMs ?? null,
		extractors: null,
		totalMs: error?.totalMs ?? null,
	};
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
				if (error.code === BUDGET_EXCEEDED) return respondIncomplete(res, { error });
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
					if (scraped.debug?.degraded) return respondIncomplete(res, { scraped });

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
				if (error.code === BUDGET_EXCEEDED) return respondIncomplete(res, { error });
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
				if (error.code === BUDGET_EXCEEDED) return respondIncomplete(res, { error });
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
