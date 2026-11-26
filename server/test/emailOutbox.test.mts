import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverEmails, type OutboxJob, type OutboxPatch, type PriceDropSender } from '../services/emailOutbox.mts';

const job: OutboxJob = {
	id: 'event-1',
	notification_id: 'note-1',
	user_id: 'user-1',
	lease_id: 'lease-1',
	attempts: 1,
	payload: { product: { name: 'Phone' }, oldPrice: 729, newPrice: 699 },
};

/** Client Supabase finto: registra gli aggiornamenti dell'outbox. */
function fakeClient({ disabled = false } = {}): { db: SupabaseClient; updates: OutboxPatch[] } {
	const updates: OutboxPatch[] = [];
	const chain = {
		select: () => chain,
		update: (patch: OutboxPatch) => {
			updates.push(patch);
			return chain;
		},
		eq: () => chain,
		maybeSingle: async () => ({ data: { email_notifications: !disabled }, error: null }),
		then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
	};
	const db = {
		rpc: async () => ({ data: [job], error: null }),
		auth: { admin: { getUserById: async () => ({ data: { user: { email: 'test@example.com' } }, error: null }) } },
		from: () => chain,
	};
	return { db: db as unknown as SupabaseClient, updates };
}

describe('consegna email recuperabile', () => {
	it("rimette in coda un invio fallito invece di simulare il successo", async () => {
		const { db, updates } = fakeClient();
		const send = vi.fn<PriceDropSender>().mockRejectedValue(new Error('SMTP unavailable'));
		await deliverEmails(db, { send });
		expect(updates[0]).toMatchObject({ status: 'pending', last_error: 'SMTP unavailable' });
		expect(updates[0]?.run_after).toBeTruthy();
	});

	it("ricontrolla le preferenze prima di inviare un'email in coda", async () => {
		const { db, updates } = fakeClient({ disabled: true });
		const send = vi.fn<PriceDropSender>();
		await deliverEmails(db, { send });
		expect(send).not.toHaveBeenCalled();
		expect(updates[0]?.status).toBe('skipped');
	});

	it("segna l'invio solo dopo l'accettazione del provider", async () => {
		const { db, updates } = fakeClient();
		const send = vi.fn<PriceDropSender>().mockResolvedValue({ accepted: ['test@example.com'] });
		expect((await deliverEmails(db, { send })).sent).toBe(1);
		expect(updates[0]?.status).toBe('sent');
		expect(send).toHaveBeenCalledWith('test@example.com', { name: 'Phone' }, 729, 699, 'note-1');
	});
});
