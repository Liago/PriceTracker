import { describe, it, expect, vi } from 'vitest';
import storeModule from '../../scrape/recipe/store.js';

const { createRecipeStore } = storeModule;

/**
 * Client Supabase finto: registra le chiamate e restituisce cio' che gli si
 * dice. Basta a verificare la logica dello store senza un database.
 */
function fakeClient({ rows = [], insertResult = null, onUpdate = () => ({ error: null }), onInsert } = {}) {
	const calls = { selects: [], inserts: [], updates: [] };

	const builder = (table) => {
		const state = { table, filters: {}, order: null, limitValue: null };

		const chain = {
			select() { return chain; },
			eq(column, value) { state.filters[column] = value; return chain; },
			order(column, opts) { state.order = { column, ...opts }; return chain; },
			limit(n) { state.limitValue = n; return chain; },
			async maybeSingle() {
				calls.selects.push(state);
				const matched = rows.filter((row) =>
					Object.entries(state.filters).every(([k, v]) => row[k] === v));
				return { data: matched[0] ?? null, error: null };
			},
			async single() {
				calls.inserts.push(state);
				return { data: insertResult, error: null };
			},
			insert(payload) {
				state.payload = payload;
				calls.inserts.push(state);
				if (onInsert) return onInsert(payload, state);
				return {
					select: () => ({ single: async () => ({ data: { id: 'nuova', ...payload }, error: null }) }),
				};
			},
			update(payload) {
				state.payload = payload;
				calls.updates.push(state);
				return {
					eq(column, value) {
						state.filters[column] = value;
						return { ...chain, then: undefined, ...onUpdate(state) };
					},
				};
			},
			then(resolve) {
				calls.selects.push(state);
				const matched = rows.filter((row) =>
					Object.entries(state.filters).every(([k, v]) => row[k] === v));
				const ordered = state.order && state.order.ascending === false
					? [...matched].sort((a, b) => b[state.order.column] - a[state.order.column])
					: matched;
				return resolve({ data: state.limitValue ? ordered.slice(0, state.limitValue) : ordered, error: null });
			},
		};
		return chain;
	};

	return { from: (table) => builder(table), calls };
}

const validRecipe = () => ({
	domain: 'shop.it',
	url_pattern: '*',
	scope: 'domain',
	fields: { price: { strategy: 'css', selector: '.price', attr: null } },
	confidence: 0.8,
});

describe('getActiveRecipe', () => {
	it('restituisce la ricetta attiva del dominio', async () => {
		const client = fakeClient({ rows: [{ id: 'r1', domain: 'shop.it', status: 'active' }] });
		const store = createRecipeStore({ client });

		const recipe = await store.getActiveRecipe('https://www.shop.it/p/123');
		expect(recipe.id).toBe('r1');
	});

	it('normalizza il dominio togliendo il www', async () => {
		const client = fakeClient({ rows: [{ id: 'r1', domain: 'shop.it', status: 'active' }] });
		const store = createRecipeStore({ client });

		expect(await store.getActiveRecipe('https://www.shop.it/p')).not.toBeNull();
		expect(await store.getActiveRecipe('https://shop.it/p')).not.toBeNull();
	});

	it('restituisce null se non c\'e\' nulla', async () => {
		const store = createRecipeStore({ client: fakeClient({ rows: [] }) });
		expect(await store.getActiveRecipe('https://ignoto.it/p')).toBeNull();
	});

	it('mette in cache: due letture, una sola query', async () => {
		const client = fakeClient({ rows: [{ id: 'r1', domain: 'shop.it', status: 'active' }] });
		const store = createRecipeStore({ client });

		await store.getActiveRecipe('https://shop.it/p/1');
		await store.getActiveRecipe('https://shop.it/p/2');
		expect(client.calls.selects).toHaveLength(1);
	});

	it('regge un URL non valido e l\'assenza di client', async () => {
		const store = createRecipeStore({ client: fakeClient({}) });
		expect(await store.getActiveRecipe('non-un-url')).toBeNull();
		expect(await createRecipeStore({}).getActiveRecipe('https://x.it/p')).toBeNull();
	});
});

describe('saveLearnedRecipe', () => {
	it('salva come candidate, mai direttamente attiva', async () => {
		const client = fakeClient({ rows: [] });
		const store = createRecipeStore({ client });

		const { saved } = await store.saveLearnedRecipe(validRecipe());
		expect(saved.status).toBe('candidate');
		expect(saved.version).toBe(1);
	});

	it('incrementa la versione quando ne esiste gia\' una', async () => {
		const client = fakeClient({
			rows: [{ domain: 'shop.it', url_pattern: '*', scope: 'domain', version: 4, fields: { price: { strategy: 'meta', key: 'x' } } }],
		});
		const store = createRecipeStore({ client });

		const { saved } = await store.saveLearnedRecipe(validRecipe());
		expect(saved.version).toBe(5);
	});

	it('non crea una versione nuova se la strategia e\' identica', async () => {
		// Altrimenti ogni scoperta accumulerebbe righe identiche.
		const recipe = validRecipe();
		const client = fakeClient({
			rows: [{ domain: 'shop.it', url_pattern: '*', scope: 'domain', version: 1, fields: recipe.fields }],
		});
		const store = createRecipeStore({ client });

		const { saved, reason } = await store.saveLearnedRecipe(recipe);
		expect(saved).toBeNull();
		expect(reason).toContain('identica');
	});

	it('rifiuta una ricetta non valida senza toccare il database', async () => {
		const client = fakeClient({ rows: [] });
		const store = createRecipeStore({ client });

		const { saved, reason } = await store.saveLearnedRecipe({ domain: 'shop.it', fields: {} });
		expect(saved).toBeNull();
		expect(reason).toContain('non valida');
		expect(client.calls.inserts).toHaveLength(0);
	});
});

describe('recordOutcome', () => {
	const recipe = (overrides) => ({
		id: 'r1', domain: 'shop.it', url_pattern: '*', scope: 'domain',
		status: 'candidate', success_count: 2, failure_count: 0, consecutive_failures: 0,
		...overrides,
	});

	it('promuove una candidate al terzo successo', async () => {
		const client = fakeClient({});
		const store = createRecipeStore({ client });

		const outcome = await store.recordOutcome(recipe(), true);
		expect(outcome.status).toBe('active');
		expect(outcome.promoted).toBe(true);
	});

	it('deprecа la precedente attiva PRIMA di promuovere', async () => {
		// L'ordine conta: l'indice unico parziale a database rifiuterebbe una
		// seconda riga attiva.
		const client = fakeClient({});
		const store = createRecipeStore({ client });

		await store.recordOutcome(recipe(), true);

		const [primo, secondo] = client.calls.updates;
		expect(primo.payload.status).toBe('deprecated');
		expect(primo.filters.status).toBe('active');
		expect(secondo.payload.status).toBe('active');
	});

	it('manda in quarantena al terzo fallimento consecutivo', async () => {
		const client = fakeClient({});
		const store = createRecipeStore({ client });

		const outcome = await store.recordOutcome(
			recipe({ status: 'active', consecutive_failures: 2 }), false);

		expect(outcome.status).toBe('quarantined');
		expect(outcome.quarantined).toBe(true);
	});

	it('aggiorna i contatori e la data giusta', async () => {
		const client = fakeClient({});
		const store = createRecipeStore({ client });

		await store.recordOutcome(recipe({ status: 'active', success_count: 5 }), true);
		const update = client.calls.updates[0].payload;

		expect(update.success_count).toBe(6);
		expect(update.consecutive_failures).toBe(0);
		expect(update.last_success_at).toBeTruthy();
		expect(update.last_failure_at).toBeUndefined();
	});

	it('non fa nulla senza ricetta o senza client', async () => {
		const store = createRecipeStore({ client: fakeClient({}) });
		await expect(store.recordOutcome(null, true)).resolves.toBeTruthy();
		await expect(createRecipeStore({}).recordOutcome(recipe(), true)).resolves.toBeTruthy();
	});
});
