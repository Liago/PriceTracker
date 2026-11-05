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
const { requireResult } = require('../../server/services/trackingRepository');
const { normalizeUserSettings } = require('../../server/services/userSettings');
const { checkUrl } = require('../../server/scrape/policy/urlPolicy');
const { checkProduct } = require('../../server/services/productChecker');
const { createTrackingRepository } = require('../../server/services/trackingRepository');
const { scrapeProduct } = require('../../server/services/scraper');

const BATCH_SIZE = parseInt(process.env.SCRAPE_WORKER_BATCH || '5', 10);
// Scheduled functions allow 30 seconds; reserve time for audit and persistence.
const TIME_BUDGET_MS = parseInt(process.env.SCRAPE_WORKER_BUDGET_MS || '26000', 10);
const RESERVE_MS = 4000;

function createWorker({ createClientImpl = createClient, scrapeImpl = scrapeProduct, checkUrlImpl = checkUrl, now = () => Date.now() } = {}) {
return async () => {
	const startedAt = now();
	const workerId = `worker-${Math.random().toString(36).slice(2, 10)}`;

	const client = createClientImpl(
		process.env.SUPABASE_URL,
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
	);

	const queue = createJobQueue({ client });
	const recipes = createRecipeStore({ client });
	const repo = createTrackingRepository(client);

	const processed = [];

	try {
		const jobs = await queue.claim(workerId, BATCH_SIZE);
		if (jobs.length === 0) {
			return { statusCode: 200, body: JSON.stringify({ message: 'coda vuota', workerId }) };
		}

		for (const job of jobs) {
			// Budget: se non c'e' tempo per un altro controllo si lascia il job
			// alla prossima invocazione invece di iniziarlo e non finirlo.
			if (now() - startedAt > TIME_BUDGET_MS - RESERVE_MS) {
				await queue.defer(job, 'budget di tempo esaurito, riaccodato');
				continue;
			}

			// Limite di frequenza del dominio, condiviso fra tutti gli utenti.
			const profile = await recipes.getDomainProfile(job.url);
			const gate = requireResult(await client.rpc('reserve_scrape_domain', { p_domain: job.domain, p_interval_ms: Math.max(1000, Math.ceil(60000 / (profile?.rate_limit_rpm || 6))) }), 'Prenotazione dominio');
			if (!gate.allowed) {
				await queue.defer(job, `limite di frequenza, riprovo fra ${Math.round(gate.waitMs / 1000)}s`, gate.waitMs);
				continue;
			}

			try {
				const policy = await checkUrlImpl(job.url, { domainProfile: profile });


				const { data: product, error } = await client
					.from('products').select('*').eq('id', job.product_id).maybeSingle();
				if (error) throw new Error(`Lettura prodotto fallita: ${error.message}`);
				if (!product) {
					await queue.complete(job.id); // prodotto sparito: il job non ha piu' senso
					continue;
				}

				if (product.monitoring_until && product.monitoring_until < new Date().toISOString().slice(0, 10)) { await queue.complete(job.id); continue; }
				const settingsRow = requireResult(await client.from('user_settings').select('*').eq('user_id', product.user_id).maybeSingle(), 'Impostazioni');
				const settings = normalizeUserSettings(settingsRow);
				const recipe = await recipes.getActiveRecipe(product.url, product.id);
				let lastResult = null;
				const scrape = async (url, options = {}) => {
					if (!policy.allowed) {
						const failure = new Error(`URL non ammesso: ${policy.reason}`);
						failure.antiBotSuspected = ['dominio_bloccato', 'escluso_da_robots'].includes(policy.reason);
						throw failure;
					}
					// Il budget del singolo controllo e' cio' che resta al worker:
					// senza, il motore userebbe il proprio default e potrebbe
					// sforare il lotto invece di lasciare il job al prossimo giro.
					lastResult = await scrapeImpl(url, {
						recipe: options.confirmation ? null : recipe,
						maxRetries: settings.maxRetries,
						lastKnownPrice: product.current_price ?? null,
						budgetMs: Math.max(TIME_BUDGET_MS - RESERVE_MS - (now() - startedAt), 2000),
					});
					return lastResult;
				};

				const outcome = await checkProduct({ product, scrape, repo });

				await recipes.evaluateCandidates(product.url, lastResult, product.id, outcome.accepted).catch(error => console.warn('[Recipe]', error.message));

				if (outcome.accepted && !recipe && lastResult) {
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
			body: JSON.stringify({ workerId, processed: processed.length, pending, durationMs: now() - startedAt }),
		};
	} catch (error) {
		console.error(`[Worker ${workerId}] Errore:`, error.message);
		return { statusCode: 500, body: JSON.stringify({ error: error.message, workerId }) };
	}
};

}
module.exports = { createWorker, handler: createWorker() };
