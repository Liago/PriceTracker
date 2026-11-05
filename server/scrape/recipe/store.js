/**
 * Lettura e scrittura delle ricette a database.
 *
 * Il client Supabase e' iniettabile: il modulo e' testabile senza database, e
 * chi lo usa decide con quale identita' parlare. Le tre tabelle sono scrivibili
 * solo dal service_role, quindi qui va passato il client amministrativo.
 *
 * Cache in processo con TTL breve: in una function serverless il processo vive
 * poco, ma dentro un singolo worker che elabora un lotto di prodotti evita di
 * rileggere la stessa ricetta per ogni prodotto dello stesso dominio.
 */

const { validateRecipe } = require('./schema');
const { domainOf } = require('./learner');

const DEFAULT_TTL_MS = 60000;

/**
 * @param {object} options
 * @param {object} options.client - client Supabase con privilegi service_role
 * @param {number} [options.ttlMs]
 */
function createRecipeStore({ client, ttlMs = DEFAULT_TTL_MS } = {}) {
	const cache = new Map();

	const cacheGet = (key) => {
		const entry = cache.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			cache.delete(key);
			return undefined;
		}
		return entry.value;
	};

	const cacheSet = (key, value) => {
		cache.set(key, { value, expiresAt: Date.now() + ttlMs });
	};

	/**
	 * La ricetta attiva per un dominio, se esiste.
	 *
	 * L'invariante "al piu' una attiva per ambito" e' garantita da un indice
	 * unico parziale a database, quindi qui non serve arbitrare fra piu'
	 * candidate.
	 *
	 * @param {string} url
	 * @returns {Promise<object|null>}
	 */
	function applies(recipe, url, productId) {
		if (recipe.scope === 'product') return recipe.product_id === productId;
		if (recipe.scope !== 'url_pattern') return true;
		const escaped = String(recipe.url_pattern || '*').split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
		return new RegExp(`^${escaped}$`).test(url);
	}
	async function getActiveRecipe(url, productId = null) {
		const domain = domainOf(url);
		if (!domain || !client) return null;
		let rows = cacheGet(`recipe:${domain}`);
		if (rows === undefined) {
			const { data, error } = await client.from('scrape_recipes').select('*').eq('domain', domain).eq('status', 'active');
			if (error) throw new Error(`Lettura ricette fallita: ${error.message}`);
			rows = data || []; cacheSet(`recipe:${domain}`, rows);
		}
		return [...rows].filter(row => applies(row, url, productId)).sort((a,b) =>
			({product:3,url_pattern:2,domain:1}[b.scope] || 1) - ({product:3,url_pattern:2,domain:1}[a.scope] || 1)
			|| (b.url_pattern?.length || 0) - (a.url_pattern?.length || 0) || b.version-a.version)[0] || null;
	}

	/**
	 * Salva una ricetta appresa come nuova versione candidate.
	 *
	 * Non tocca la ricetta attiva: la sostituzione avviene solo dopo che la
	 * candidate ha accumulato abbastanza successi. E' cio' che impedisce a un
	 * errore occasionale di diventare la configurazione ufficiale.
	 *
	 * @param {object} recipe - uscita di learnRecipe
	 * @returns {Promise<{saved: object|null, reason: string}>}
	 */
	async function saveLearnedRecipe(recipe) {
		if (!client) return { saved: null, reason: 'nessun client' };

		const validation = validateRecipe(recipe);
		if (!validation.valid) {
			return { saved: null, reason: `ricetta non valida: ${validation.errors.join('; ')}` };
		}

		const { data: existing, error: readError } = await client
			.from('scrape_recipes')
			.select('version, fields, status')
			.eq('domain', recipe.domain)
			.eq('url_pattern', recipe.url_pattern || '*')
			.eq('scope', recipe.scope || 'domain')
			.order('version', { ascending: false })
			.limit(1);

		if (readError) return { saved: null, reason: readError.message };

		const previous = existing && existing[0];

		// Se la strategia e' identica a quella gia' registrata non si crea una
		// versione nuova: si accumulerebbero righe identiche a ogni scoperta.
		if (previous && JSON.stringify(previous.fields) === JSON.stringify(recipe.fields)) {
			return { saved: null, reason: 'identica alla versione esistente' };
		}

		const version = previous ? previous.version + 1 : 1;

		const { data, error } = await client
			.from('scrape_recipes')
			.insert({
				domain: recipe.domain,
				url_pattern: recipe.url_pattern || '*',
				scope: recipe.scope || 'domain',
				product_id: recipe.product_id ?? null,
				version,
				status: 'candidate',
				origin: recipe.origin || 'learned',
				transport: recipe.transport || 'http',
				fields: recipe.fields,
				confidence: recipe.confidence ?? 0,
				learned_from_run: recipe.learned_from_run ?? null,
			})
			.select()
			.single();

		if (error) return { saved: null, reason: error.message };

		cache.delete(`recipe:${recipe.domain}`);
		return { saved: data, reason: 'ok' };
	}

	/**
	 * Aggiorna i contatori di una ricetta dopo un'esecuzione e, se serve,
	 * il suo stato.
	 *
	 * @param {object} recipe - riga corrente
	 * @param {boolean} succeeded
	 * @returns {Promise<{status: string, promoted: boolean, quarantined: boolean}>}
	 */
	async function recordOutcome(recipe, succeeded) {
		if (!client || !recipe?.id) return { status: recipe?.status ?? 'unknown', promoted: false, quarantined: false };
		const { data, error } = await client.rpc('record_recipe_evaluation', { p_recipe_id: recipe.id, p_succeeded: succeeded });
		if (error) throw new Error(`Valutazione ricetta fallita: ${error.message}`);
		cache.delete(`recipe:${recipe.domain}`); return data;
	}
	async function evaluateCandidates(url, result, productId = null, accepted = true) {
		if (!client || !result || result.debug?.degraded) return;
		const domain = domainOf(url);
		const { data, error } = await client.from('scrape_recipes').select('*').eq('domain', domain);
		if (error) throw new Error(`Lettura candidate fallita: ${error.message}`);
		for (const recipe of data || []) {
			if (!['candidate','active'].includes(recipe.status) || !applies(recipe, url, productId)) continue;
			const spec = recipe.fields?.price;
			const evidence = (result.candidates || []).filter(c => c.field === 'price' && c.source !== 'recipe' && c.locator?.strategy === spec?.strategy
				&& (!spec.selector || c.locator.selector === spec.selector) && (!spec.key || c.locator.key === spec.key));
			// Missing evidence is not a failed execution of this candidate.
			if (recipe.status === 'candidate' && (!accepted || result.confidence < 0.85 || !evidence.length)) continue;
			if (recipe.status === 'active' && result.recipeId !== recipe.id) continue;
			await recordOutcome(recipe, accepted && evidence.some(c => Math.abs(c.value - result.priceValue) < 0.005));
		}
	}

	/**
	 * Profilo di un dominio, se registrato.
	 * @returns {Promise<object|null>}
	 */
	async function getDomainProfile(url) {
		const domain = domainOf(url);
		if (!domain || !client) return null;

		const cached = cacheGet(`domain:${domain}`);
		if (cached !== undefined) return cached;

		const { data, error } = await client
			.from('domain_profiles')
			.select('*')
			.eq('domain', domain)
			.maybeSingle();

		if (error) {
			console.warn(`[Recipe] Lettura profilo dominio fallita per ${domain}:`, error.message);
			return null;
		}

		cacheSet(`domain:${domain}`, data ?? null);
		return data ?? null;
	}

	function clearCache() {
		cache.clear();
	}

	return {
		getActiveRecipe,
		saveLearnedRecipe,
		recordOutcome,
		evaluateCandidates,
		getDomainProfile,
		clearCache,
	};
}

module.exports = { createRecipeStore, DEFAULT_TTL_MS };
