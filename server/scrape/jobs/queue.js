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
			else if (error.code === '23505') skipped++;
			else throw new Error(`Accodamento fallito: ${error.message}`);
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
			throw new Error(`Claim fallito: ${error.message}`);
		}
		return data || [];
	}

	/** Segna un job come completato. */
	async function complete(jobId) {
		if (!client) return;
		const { error } = await client.from('scrape_jobs')
			.update({ status: 'done', updated_at: new Date().toISOString() })
			.eq('id', jobId);
		if (error) throw new Error(`Completamento job fallito: ${error.message}`);
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

		const { error } = await client.from('scrape_jobs').update({
			status: exhausted ? 'dead' : 'pending',
			last_error: String(errorMessage).slice(0, 500),
			run_after: exhausted ? undefined : new Date(Date.now() + delay).toISOString(),
			claimed_by: null,
			claimed_at: null,
			updated_at: new Date().toISOString(),
		}).eq('id', job.id);
		if (error) throw new Error(`Aggiornamento job fallito: ${error.message}`);
	}

	/** A reservation is not a failed page read. Return its attempt to the budget. */
	async function defer(job, reason, waitMs = 60000) {
		const { error } = await client.from('scrape_jobs').update({ status: 'pending', attempts: Math.max(0, (job.attempts ?? 1) - 1),
			run_after: new Date(Date.now() + Math.max(1000, waitMs)).toISOString(), last_error: reason,
			claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() }).eq('id', job.id);
		if (error) throw new Error(`Rinvio fallito: ${error.message}`);
	}

	/** Rimette in coda i job lasciati appesi da un worker morto. */
	async function requeueStale() {
		if (!client) return 0;
		const { data, error } = await client.rpc('requeue_stale_scrape_jobs', {});
		if (error) {
			throw new Error(`Requeue fallito: ${error.message}`);
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
		if (error) throw new Error(`Conteggio coda fallito: ${error.message}`);
		return count ?? 0;
	}

	return { enqueueDue, claim, complete, fail, defer, requeueStale, pendingCount, domainOf };
}

module.exports = { createJobQueue, domainOf };
