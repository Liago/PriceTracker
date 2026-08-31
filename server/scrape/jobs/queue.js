/**
 * Coda dei controlli prezzo.
 *
 * Il client Supabase e' iniettabile, come per le ricette: la logica resta
 * verificabile senza database.
 */

const { isDue, priorityOf } = require('./schedule');

/** Dominio normalizzato, senza www. */
function domainOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch (e) {
		return 'sconosciuto';
	}
}

/**
 * @param {object} options
 * @param {object} options.client - client Supabase con privilegi service_role
 */
function createJobQueue({ client } = {}) {
	/**
	 * Accoda i prodotti dovuti.
	 *
	 * L'indice unico parziale a database impedisce di accodare due volte lo
	 * stesso prodotto, quindi un dispatcher che gira due volte non raddoppia il
	 * lavoro: qui si ignorano semplicemente i conflitti.
	 *
	 * @param {Array<object>} products
	 * @param {function} intervalResolver - (product) => minuti dall'impostazione utente
	 * @param {object} [options]
	 * @returns {Promise<{enqueued: number, skipped: number}>}
	 */
	async function enqueueDue(products, intervalResolver, options = {}) {
		const { now = new Date(), trigger = 'scheduled' } = options;

		const rows = [];
		let skipped = 0;

		for (const product of products || []) {
			const base = await intervalResolver(product);
			const { due } = isDue(product, base, { now });
			if (!due) { skipped++; continue; }

			rows.push({
				product_id: product.id,
				url: product.url,
				domain: domainOf(product.url),
				priority: priorityOf(product),
				trigger,
			});
		}

		if (rows.length === 0) return { enqueued: 0, skipped };
		if (!client) return { enqueued: 0, skipped };

		// Un inserimento per riga: un conflitto su un prodotto gia' in coda non
		// deve far fallire l'accodamento degli altri.
		let enqueued = 0;
		for (const row of rows) {
			const { error } = await client.from('scrape_jobs').insert(row);
			if (!error) enqueued++;
			else skipped++;
		}

		return { enqueued, skipped };
	}

	/**
	 * Prende un lotto di job. Il claim e' atomico lato database.
	 * @returns {Promise<Array<object>>}
	 */
	async function claim(workerId, batchSize = 10, onlyDomains = null) {
		if (!client) return [];
		const { data, error } = await client.rpc('claim_scrape_jobs', {
			worker_id: workerId,
			batch_size: batchSize,
			only_domains: onlyDomains,
		});
		if (error) {
			console.error('[Queue] Claim fallito:', error.message);
			return [];
		}
		return data || [];
	}

	/** Segna un job come completato. */
	async function complete(jobId) {
		if (!client) return;
		await client.from('scrape_jobs')
			.update({ status: 'done', updated_at: new Date().toISOString() })
			.eq('id', jobId);
	}

	/**
	 * Segna un job come fallito.
	 *
	 * Se restano tentativi torna in coda con un ritardo crescente; esauriti,
	 * diventa 'dead' e smette di consumare risorse.
	 */
	async function fail(job, errorMessage, options = {}) {
		if (!client) return;
		const { backoffBaseMs = 60000 } = options;

		const exhausted = (job.attempts ?? 1) >= (job.max_attempts ?? 3);
		const delay = backoffBaseMs * Math.pow(2, Math.max(0, (job.attempts ?? 1) - 1));

		await client.from('scrape_jobs').update({
			status: exhausted ? 'dead' : 'pending',
			last_error: String(errorMessage).slice(0, 500),
			run_after: exhausted ? undefined : new Date(Date.now() + delay).toISOString(),
			claimed_by: null,
			claimed_at: null,
			updated_at: new Date().toISOString(),
		}).eq('id', job.id);
	}

	/** Rimette in coda i job lasciati appesi da un worker morto. */
	async function requeueStale() {
		if (!client) return 0;
		const { data, error } = await client.rpc('requeue_stale_scrape_jobs', {});
		if (error) {
			console.error('[Queue] Requeue fallito:', error.message);
			return 0;
		}
		return data ?? 0;
	}

	/** Quanti job restano in attesa. */
	async function pendingCount() {
		if (!client) return 0;
		const { count, error } = await client
			.from('scrape_jobs')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'pending');
		return error ? 0 : (count ?? 0);
	}

	return { enqueueDue, claim, complete, fail, requeueStale, pendingCount, domainOf };
}

module.exports = { createJobQueue, domainOf };
