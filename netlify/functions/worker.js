/**
 * Worker: consuma un lotto di job dalla coda entro il proprio budget di tempo.
 *
 * Il budget e' la ragione per cui questa function esiste: si smette di
 * prendere lavoro quando il tempo residuo non basta per un altro controllo,
 * invece di essere interrotti a meta'. Un job interrotto resta 'claimed' e
 * viene rimesso in coda dal dispatcher, quindi nulla si perde - ma smettere
 * per tempo evita di doverci arrivare.
 */

const { createClient } = require('@supabase/supabase-js');
const { createJobQueue } = require('../../server/scrape/jobs/queue');
const { createRecipeStore } = require('../../server/scrape/recipe/store');
const { learnRecipe } = require('../../server/scrape/recipe/learner');
const { createRateLimiter } = require('../../server/scrape/policy/rateLimiter');
const { checkUrl } = require('../../server/scrape/policy/urlPolicy');
const { checkProduct } = require('../../server/services/productChecker');
const { createTrackingRepository } = require('../../server/services/trackingRepository');
const { scrapeProduct } = require('../../server/services/scraper');

const BATCH_SIZE = parseInt(process.env.SCRAPE_WORKER_BATCH || '5', 10);
// Netlify concede 26 secondi alle background function e 10 alle normali; si
// tiene un margine per chiudere il browser e scrivere gli esiti.
const TIME_BUDGET_MS = parseInt(process.env.SCRAPE_WORKER_BUDGET_MS || '20000', 10);
const RESERVE_MS = 6000;

module.exports.handler = async () => {
	const startedAt = Date.now();
	const workerId = `worker-${Math.random().toString(36).slice(2, 10)}`;

	const client = createClient(
		process.env.SUPABASE_URL,
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
	);

	const queue = createJobQueue({ client });
	const recipes = createRecipeStore({ client });
	const repo = createTrackingRepository(client);
	const limiter = createRateLimiter();

	const processed = [];

	try {
		const jobs = await queue.claim(workerId, BATCH_SIZE);
		if (jobs.length === 0) {
			return { statusCode: 200, body: JSON.stringify({ message: 'coda vuota', workerId }) };
		}

		for (const job of jobs) {
			// Budget: se non c'e' tempo per un altro controllo si lascia il job
			// alla prossima invocazione invece di iniziarlo e non finirlo.
			if (Date.now() - startedAt > TIME_BUDGET_MS - RESERVE_MS) {
				await queue.fail(job, 'budget di tempo esaurito, riaccodato');
				continue;
			}

			// Limite di frequenza del dominio, condiviso fra tutti gli utenti.
			const profile = await recipes.getDomainProfile(job.url);
			const gate = limiter.tryAcquire(job.domain, profile || {});
			if (!gate.allowed) {
				await queue.fail(job, `limite di frequenza, riprovo fra ${Math.round(gate.waitMs / 1000)}s`);
				continue;
			}

			try {
				const policy = await checkUrl(job.url, { domainProfile: profile });
				if (!policy.allowed) {
					await queue.fail(job, `URL non ammesso: ${policy.reason}`);
					continue;
				}

				const { data: product, error } = await client
					.from('products').select('*').eq('id', job.product_id).maybeSingle();
				if (error || !product) {
					await queue.complete(job.id); // prodotto sparito: il job non ha piu' senso
					continue;
				}

				const recipe = await recipes.getActiveRecipe(product.url);
				let lastResult = null;
				const scrape = async (url) => {
					lastResult = await scrapeProduct(url, {
						recipe, lastKnownPrice: product.current_price ?? null,
					});
					return lastResult;
				};

				const outcome = await checkProduct({ product, scrape, repo });

				if (recipe) {
					await recipes.recordOutcome(recipe, outcome.accepted);
				} else if (outcome.accepted && lastResult) {
					const { recipe: learned } = learnRecipe(lastResult, { url: product.url });
					if (learned) await recipes.saveLearnedRecipe(learned);
				}

				await queue.complete(job.id);
				processed.push({ productId: job.product_id, accepted: outcome.accepted, health: outcome.health });
			} catch (jobError) {
				await queue.fail(job, jobError.message);
				processed.push({ productId: job.product_id, error: jobError.message });
			}
		}

		const pending = await queue.pendingCount();
		console.log(`[Worker ${workerId}] ${processed.length} job, ${pending} ancora in attesa`);

		return {
			statusCode: 200,
			body: JSON.stringify({ workerId, processed: processed.length, pending, durationMs: Date.now() - startedAt }),
		};
	} catch (error) {
		console.error(`[Worker ${workerId}] Errore:`, error.message);
		return { statusCode: 500, body: JSON.stringify({ error: error.message, workerId }) };
	}
};
