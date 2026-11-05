const { requireResult } = require('./trackingRepository');
const { sendPriceDropNotification } = require('./emailService');
async function deliverEmails(client, { send = sendPriceDropNotification, limit = 1 } = {}) {
	const jobs = requireResult(await client.rpc('claim_notification_emails', { p_limit: limit }), 'Lettura email pendenti') || [];
	let sent = 0;
	for (const job of jobs) {
		let patch;
		try {
			const settings = requireResult(await client.from('user_settings').select('email_notifications').eq('user_id', job.user_id).maybeSingle(), 'Preferenze email');
			if (settings?.email_notifications === false) patch = { status: 'skipped', last_error: null };
			else {
				const data = requireResult(await client.auth.admin.getUserById(job.user_id), 'Destinatario email');
				if (!data?.user?.email) throw new Error('Indirizzo email non disponibile');
				await send(data.user.email, job.payload.product, Number(job.payload.oldPrice), Number(job.payload.newPrice), job.notification_id);
				patch = { status: 'sent', sent_at: new Date().toISOString(), last_error: null }; sent++;
			}
		} catch (error) {
			patch = { status: job.attempts >= 5 ? 'dead' : 'pending', last_error: String(error.message).slice(0, 500),
				run_after: new Date(Date.now() + Math.min(2 ** job.attempts, 60) * 60000).toISOString() };
		}
		requireResult(await client.from('notification_outbox').update(patch).eq('id', job.id).eq('lease_id', job.lease_id), 'Esito consegna email');
	}
	return { sent, processed: jobs.length };
}
module.exports = { deliverEmails };
