import type { SupabaseClient } from '@supabase/supabase-js';
import { requireResult } from './trackingRepository.js';
import { sendPriceDropNotification, type PriceDropProduct } from './emailService.mts';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type OutboxStatus = 'pending' | 'sent' | 'skipped' | 'dead';

export interface OutboxPayload {
	product: PriceDropProduct;
	oldPrice: number | string;
	newPrice: number | string;
}

/** Riga restituita da claim_notification_emails */
export interface OutboxJob {
	id: string;
	notification_id: string;
	user_id: string;
	lease_id: string;
	attempts: number;
	payload: OutboxPayload;
}

export interface OutboxPatch {
	status: OutboxStatus;
	last_error: string | null;
	sent_at?: string;
	run_after?: string;
}

export type PriceDropSender = (
	userEmail: string,
	product: PriceDropProduct,
	oldPrice: number,
	newPrice: number,
	notificationId?: string,
) => Promise<unknown>;

export interface DeliverOptions {
	/** Funzione di invio, sostituibile nei test */
	send?: PriceDropSender;
	/** Numero massimo di job da prendere in carico */
	limit?: number;
}

export interface DeliverResult {
	sent: number;
	processed: number;
}

// ---------------------------------------------------------------------------
// Consegna
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MINUTES = 60;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Backoff esponenziale in minuti, limitato a un'ora. */
const retryAt = (attempts: number): string =>
	new Date(Date.now() + Math.min(2 ** attempts, MAX_BACKOFF_MINUTES) * 60_000).toISOString();

/**
 * Consegna le email in coda in notification_outbox.
 * Ogni job viene marcato come inviato solo dopo l'accettazione da parte del
 * provider; in caso di errore torna in coda con backoff, fino a MAX_ATTEMPTS.
 */
export async function deliverEmails(
	client: SupabaseClient,
	{ send = sendPriceDropNotification, limit = 1 }: DeliverOptions = {},
): Promise<DeliverResult> {
	const jobs: OutboxJob[] =
		requireResult(await client.rpc('claim_notification_emails', { p_limit: limit }), 'Lettura email pendenti') || [];
	let sent = 0;

	for (const job of jobs) {
		let patch: OutboxPatch;
		try {
			const settings: { email_notifications?: boolean } | null = requireResult(
				await client.from('user_settings').select('email_notifications').eq('user_id', job.user_id).maybeSingle(),
				'Preferenze email',
			);
			if (settings?.email_notifications === false) {
				patch = { status: 'skipped', last_error: null };
			} else {
				const data = requireResult(await client.auth.admin.getUserById(job.user_id), 'Destinatario email');
				const email: string | undefined = data?.user?.email;
				if (!email) throw new Error('Indirizzo email non disponibile');
				await send(email, job.payload.product, Number(job.payload.oldPrice), Number(job.payload.newPrice), job.notification_id);
				patch = { status: 'sent', sent_at: new Date().toISOString(), last_error: null };
				sent++;
			}
		} catch (error) {
			patch = {
				status: job.attempts >= MAX_ATTEMPTS ? 'dead' : 'pending',
				last_error: errorMessage(error).slice(0, 500),
				run_after: retryAt(job.attempts),
			};
		}
		requireResult(
			await client.from('notification_outbox').update(patch).eq('id', job.id).eq('lease_id', job.lease_id),
			'Esito consegna email',
		);
	}

	return { sent, processed: jobs.length };
}
