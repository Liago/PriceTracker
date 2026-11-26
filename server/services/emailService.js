const nodemailer = require('nodemailer');

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;
const DEFAULT_RESEND_FROM = 'PriceTracker <onboarding@resend.dev>';

/**
 * Sceglie il provider di invio.
 * - MAIL_PROVIDER=resend|smtp forza la scelta;
 * - altrimenti Resend se RESEND_API_KEY e' presente, SMTP in caso contrario.
 */
function mailProvider() {
	const forced = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
	if (forced === 'resend' || forced === 'smtp') return forced;
	return process.env.RESEND_API_KEY ? 'resend' : 'smtp';
}

function smtpConfig() {
	const user = process.env.SMTP_USER || process.env.EMAIL_USER;
	const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
	if (!user || !pass) throw new Error('SMTP non configurato: email mantenuta in coda');
	return { host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 587),
		secure: process.env.SMTP_SECURE === 'true', auth: { user, pass },
		connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 };
}

function resendConfig() {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) throw new Error('Resend non configurato: email mantenuta in coda');
	const from = process.env.RESEND_FROM || process.env.MAIL_FROM || process.env.SMTP_FROM || DEFAULT_RESEND_FROM;
	const replyTo = process.env.RESEND_REPLY_TO || undefined;
	return { apiKey, from, replyTo };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Invio tramite API REST di Resend.
 * L'Idempotency-Key (derivata dalla notifica) evita doppi invii quando la coda
 * ritenta un job gia' accettato da Resend ma non ancora marcato come inviato.
 */
async function sendWithResend({ to, subject, html, idempotencyKey }, { fetchImpl = globalThis.fetch } = {}) {
	const { apiKey, from, replyTo } = resendConfig();
	const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
	if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);

	const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
	if (replyTo) body.reply_to = replyTo;

	let response;
	try {
		response = await fetchImpl(RESEND_API_URL, {
			method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Resend non raggiungibile: ${error.message}`);
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = payload?.message || payload?.name || response.statusText || 'errore sconosciuto';
		throw new Error(`Resend ha rifiutato l'email (${response.status}): ${detail}`);
	}
	if (!payload?.id) throw new Error('Resend non ha restituito un id per l\'email');
	return { provider: 'resend', id: payload.id, messageId: payload.id, accepted: body.to };
}

async function sendWithSmtp({ to, subject, html, messageId }) {
	const config = smtpConfig();
	const transporter = nodemailer.createTransport(config);
	const info = await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.MAIL_FROM || config.auth.user, to, subject, html, messageId });
	if (!info.accepted?.length) throw new Error('Il server SMTP non ha accettato il destinatario');
	return { provider: 'smtp', ...info };
}

/**
 * Invia un'email con il provider configurato.
 * @param {Object} options
 * @param {string} options.to - Destinatario
 * @param {string} options.subject - Oggetto
 * @param {string} options.html - Contenuto HTML
 * @param {string} [options.messageId] - Message-ID stabile (SMTP)
 * @param {string} [options.idempotencyKey] - Chiave di idempotenza (Resend)
 */
async function sendEmail(options, deps) {
	return mailProvider() === 'resend' ? sendWithResend(options, deps) : sendWithSmtp(options);
}

/**
 * Notifica di calo prezzo.
 * @param {string} userEmail
 * @param {Object} rawProduct
 * @param {number} oldPrice
 * @param {number} newPrice
 * @param {string} [notificationId]
 */
async function sendPriceDropNotification(userEmail, rawProduct, oldPrice, newPrice, notificationId) {
	const product = Object.fromEntries(Object.entries(rawProduct).map(([k,v]) => [k, escapeHtml(v)]));
	product.name ||= "Prodotto monitorato";
	const savings = (oldPrice - newPrice).toFixed(2);
	const currency = product.currency || 'EUR';

	const subject = `🔥 Price Drop Alert: ${product.name.substring(0, 50)}...`;

	const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Good news! A price you are tracking has dropped.</h2>

      <div style="border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <img src="${product.image}" alt="${product.name}" style="max-width: 100px; max-height: 100px; object-fit: contain; float: left; margin-right: 15px;">
        <div style="overflow: hidden;">
          <h3 style="margin-top: 0;"><a href="${product.url}" style="text-decoration: none; color: #111827;">${product.name}</a></h3>
          <p style="font-size: 1.1em;">
            <span style="text-decoration: line-through; color: #6b7280;">${currency} ${oldPrice}</span>
            <span style="color: #ef4444; font-weight: bold; margin-left: 10px;">${currency} ${newPrice}</span>
          </p>
          <p style="color: #059669; font-weight: bold;">You save ${currency} ${savings}!</p>
        </div>
        <div style="clear: both;"></div>
      </div>

      <p>Target Price was: ${currency} ${product.target_price}</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${product.url}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Deal</a>
      </div>

      <hr style="margin-top: 40px; border: none; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 0.8em; color: #9ca3af; text-align: center;">You are receiving this because you enabled alerts for this product on PriceTracker.</p>
    </div>
  `;

	return sendEmail({
		to: userEmail, subject, html,
		messageId: notificationId ? `<${notificationId}@pricetracker.local>` : undefined,
		idempotencyKey: notificationId ? `price-drop/${notificationId}` : undefined,
	});
}

module.exports = {
	mailProvider,
	sendEmail,
	sendWithResend,
	sendPriceDropNotification
};
