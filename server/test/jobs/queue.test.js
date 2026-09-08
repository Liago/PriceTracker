import { describe, it, expect } from 'vitest';
import queueModule from '../../scrape/jobs/queue.js';

const { createJobQueue, domainOf } = queueModule;

/** Client finto: registra inserimenti, aggiornamenti e chiamate RPC. */
function fakeClient({ insertError = null, rpcResult = [] } = {}) {
	const calls = { inserts: [], updates: [], rpc: [] };

	return {
		calls,
		from() {
			return {
				insert(row) {
					calls.inserts.push(row);
					return Promise.resolve({ error: typeof insertError === 'function' ? insertError(row) : insertError });
				},
				update(patch) {
					return {
						eq(column, value) {
							calls.updates.push({ patch, [column]: value });
							return Promise.resolve({ error: null });
						},
					};
				},
			};
		},
		rpc(name, args) {
			calls.rpc.push({ name, args });
			return Promise.resolve({ data: rpcResult, error: null });
		},
	};
}

const now = new Date('2026-08-31T12:00:00Z');
const minutesAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();

describe('domainOf', () => {
	it('normalizza togliendo il www', () => {
		expect(domainOf('https://www.mediaworld.it/p')).toBe('mediaworld.it');
	});

	it('non esplode su un URL non valido', () => {
		expect(domainOf('non-un-url')).toBe('sconosciuto');
	});
});

describe('enqueueDue', () => {
	const intervallo = async () => 60;

	it('accoda solo i prodotti dovuti', async () => {
		const client = fakeClient();
		const queue = createJobQueue({ client });

		const out = await queue.enqueueDue([
			{ id: 'a', url: 'https://shop.it/1', last_checked_at: minutesAgo(120) }, // dovuto
			{ id: 'b', url: 'https://shop.it/2', last_checked_at: minutesAgo(10) },  // no
			{ id: 'c', url: 'https://shop.it/3' },                                   // mai controllato
		], intervallo, { now });

		expect(out.enqueued).toBe(2);
		expect(out.skipped).toBe(1);
		expect(client.calls.inserts.map((r) => r.product_id)).toEqual(['a', 'c']);
	});

	it('assegna priorita\' e dominio', async () => {
		const client = fakeClient();
		const queue = createJobQueue({ client });

		await queue.enqueueDue([{ id: 'a', url: 'https://www.mediaworld.it/p' }], intervallo, { now });

		expect(client.calls.inserts[0].domain).toBe('mediaworld.it');
		expect(client.calls.inserts[0].priority).toBe(10); // mai controllato
	});

	it('un conflitto su un prodotto non blocca gli altri', async () => {
		// L'indice unico a database impedisce il doppio accodamento: qui si
		// verifica che il fallimento di una riga non fermi le altre.
		const client = fakeClient({
			insertError: (row) => (row.product_id === 'a' ? { message: 'duplicate key' } : null),
		});
		const queue = createJobQueue({ client });

		const out = await queue.enqueueDue([
			{ id: 'a', url: 'https://shop.it/1' },
			{ id: 'b', url: 'https://shop.it/2' },
		], intervallo, { now });

		expect(out.enqueued).toBe(1);
		expect(out.skipped).toBe(1);
	});

	it('non chiama il database se non c\'e\' nulla da accodare', async () => {
		const client = fakeClient();
		const queue = createJobQueue({ client });

		const out = await queue.enqueueDue(
			[{ id: 'b', url: 'https://shop.it/2', last_checked_at: minutesAgo(1) }], intervallo, { now });

		expect(out.enqueued).toBe(0);
		expect(client.calls.inserts).toHaveLength(0);
	});
});

describe('claim', () => {
	it('chiama la funzione atomica con i parametri giusti', async () => {
		const client = fakeClient({ rpcResult: [{ id: 'j1' }, { id: 'j2' }] });
		const queue = createJobQueue({ client });

		const jobs = await queue.claim('worker-1', 5, ['shop.it']);

		expect(jobs).toHaveLength(2);
		expect(client.calls.rpc[0]).toEqual({
			name: 'claim_scrape_jobs',
			args: { worker_id: 'worker-1', batch_size: 5, only_domains: ['shop.it'] },
		});
	});
});

describe('fail', () => {
	it('rimette in coda con backoff se restano tentativi', async () => {
		const client = fakeClient();
		const queue = createJobQueue({ client });

		await queue.fail({ id: 'j1', attempts: 1, max_attempts: 3 }, 'timeout');
		const patch = client.calls.updates[0].patch;

		expect(patch.status).toBe('pending');
		expect(patch.run_after).toBeTruthy();
		expect(patch.last_error).toBe('timeout');
	});

	it('dichiara morto un job che ha esaurito i tentativi', async () => {
		// Un job che continua a fallire non deve consumare risorse per sempre.
		const client = fakeClient();
		const queue = createJobQueue({ client });

		await queue.fail({ id: 'j1', attempts: 3, max_attempts: 3 }, 'ancora timeout');
		expect(client.calls.updates[0].patch.status).toBe('dead');
	});

	it('il ritardo cresce con i tentativi', async () => {
		const client = fakeClient();
		const queue = createJobQueue({ client });

		await queue.fail({ id: 'j1', attempts: 1, max_attempts: 5 }, 'x');
		await queue.fail({ id: 'j2', attempts: 3, max_attempts: 5 }, 'x');

		const primo = new Date(client.calls.updates[0].patch.run_after).getTime();
		const terzo = new Date(client.calls.updates[1].patch.run_after).getTime();
		expect(terzo).toBeGreaterThan(primo);
	});
});

describe('senza client', () => {
	it('nessuna operazione esplode', async () => {
		const queue = createJobQueue({});
		await expect(queue.claim('w')).resolves.toEqual([]);
		await expect(queue.requeueStale()).resolves.toBe(0);
		await expect(queue.complete('j')).resolves.toBeUndefined();
	});
});
