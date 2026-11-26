import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type MailProvider = 'resend' | 'smtp';

export interface EmailMessage {
	/** Destinatario (o elenco di destinatari) */
	to: string | string[];
	/** Oggetto */
	subject: string;
	/** Contenuto HTML */
	html: string;
	/** Message-ID stabile, usato con SMTP per facilitare la diagnosi */
	messageId?: string;
	/** Chiave di idempotenza, usata con Resend per evitare doppi invii nei retry */
	idempotencyKey?: string;
}

export interface SendResult {
	provider: MailProvider;
	/** Identificativo del messaggio presso il provider */
	messageId: string;
	/** Destinatari accettati dal provider */
	accepted: string[];
}

export interface SendDeps {
	/** Implementazione di fetch, sostituibile nei test */
	fetchImpl?: typeof fetch;
}

export interface PriceDropProduct {
	name?: string | null;
	url?: string | null;
	image?: string | null;
	currency?: string | null;
	target_price?: number | string | null;
	[key: string]: unknown;
}

interface ResendConfig {
	apiKey: string;
	from: string;
	replyTo?: string;
}

interface ResendSuccess {
	id?: string;
}

interface ResendError {
	name?: string;
	message?: string;
}

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;
const DEFAULT_RESEND_FROM = 'PriceTracker <onboarding@resend.dev>';

const readEnv = (name: string): string | undefined => {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
};

/**
 * Sceglie il provider di invio.
 * - MAIL_PROVIDER=resend|smtp forza la scelta;
 * - altrimenti Resend se RESEND_API_KEY e' presente, SMTP in caso contrario.
 */
export function mailProvider(): MailProvider {
	const forced = readEnv('MAIL_PROVIDER')?.toLowerCase();
	if (forced === 'resend' || forced === 'smtp') return forced;
	return readEnv('RESEND_API_KEY') ? 'resend' : 'smtp';
}

function smtpConfig(): SMTPTransport.Options & { auth: { user: string; pass: string } } {
	const user = readEnv('SMTP_USER') ?? readEnv('EMAIL_USER');
	const pass = readEnv('SMTP_PASS') ?? readEnv('EMAIL_PASS');
	if (!user || !pass) throw new Error('SMTP non configurato: email mantenuta in coda');
	return {
		host: readEnv('SMTP_HOST') ?? 'smtp.gmail.com',
		port: Number(readEnv('SMTP_PORT') ?? 587),
		secure: readEnv('SMTP_SECURE') === 'true',
		auth: { user, pass },
		connectionTimeout: 5000,
		greetingTimeout: 5000,
		socketTimeout: 8000,
	};
}

function resendConfig(): ResendConfig {
	const apiKey = readEnv('RESEND_API_KEY');
	if (!apiKey) throw new Error('Resend non configurato: email mantenuta in coda');
	const from = readEnv('RESEND_FROM') ?? readEnv('MAIL_FROM') ?? readEnv('SMTP_FROM') ?? DEFAULT_RESEND_FROM;
	return { apiKey, from, replyTo: readEnv('RESEND_REPLY_TO') };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value: unknown): string =>
	String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Invio tramite API REST di Resend.
 * L'Idempotency-Key (derivata dalla notifica) evita doppi invii quando la coda
 * ritenta un job gia' accettato da Resend ma non ancora marcato come inviato.
 */
export async function sendWithResend(message: EmailMessage, { fetchImpl = globalThis.fetch }: SendDeps = {}): Promise<SendResult> {
	const { apiKey, from, replyTo } = resendConfig();
	const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
	if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey.slice(0, 256);

	const to = Array.isArray(message.to) ? message.to : [message.to];
	const body: Record<string, unknown> = { from, to, subject: message.subject, html: message.html };
	if (replyTo) body.reply_to = replyTo;

	let response: Response;
	try {
		response = await fetchImpl(RESEND_API_URL, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`Resend non raggiungibile: ${errorMessage(error)}`);
	}

	const payload = (await response.json().catch(() => ({}))) as ResendSuccess & ResendError;
	if (!response.ok) {
		const detail = payload.message || payload.name || response.statusText || 'errore sconosciuto';
		throw new Error(`Resend ha rifiutato l'email (${response.status}): ${detail}`);
	}
	if (!payload.id) throw new Error("Resend non ha restituito un id per l'email");
	return { provider: 'resend', messageId: payload.id, accepted: to };
}

export async function sendWithSmtp(message: EmailMessage): Promise<SendResult> {
	const config = smtpConfig();
	const transporter = nodemailer.createTransport(config);
	const info = await transporter.sendMail({
		from: readEnv('SMTP_FROM') ?? readEnv('MAIL_FROM') ?? config.auth.user,
		to: message.to,
		subject: message.subject,
		html: message.html,
		messageId: message.messageId,
	});
	const accepted = info.accepted.map(address => (typeof address === 'string' ? address : address.address));
	if (!accepted.length) throw new Error('Il server SMTP non ha accettato il destinatario');
	return { provider: 'smtp', messageId: info.messageId, accepted };
}

/** Invia un'email con il provider configurato. */
export async function sendEmail(message: EmailMessage, deps?: SendDeps): Promise<SendResult> {
	return mailProvider() === 'resend' ? sendWithResend(message, deps) : sendWithSmtp(message);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Notifica di calo prezzo. */
export async function sendPriceDropNotification(
	userEmail: string,
	rawProduct: PriceDropProduct,
	oldPrice: number,
	newPrice: number,
	notificationId?: string,
): Promise<SendResult> {
	const product: Record<string, string> = Object.fromEntries(
		Object.entries(rawProduct).map(([key, value]) => [key, escapeHtml(value)]),
	);
	const name = product.name || 'Prodotto monitorato';
	const url = product.url ?? '';
	const image = product.image ?? '';
	const currency = product.currency || 'EUR';
	const targetPrice = product.target_price ?? '';
	const savings = (oldPrice - newPrice).toFixed(2);

	const subject = `🔥 Price Drop Alert: ${name.substring(0, 50)}...`;

	const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Good news! A price you are tracking has dropped.</h2>

      <div style="border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <img src="${image}" alt="${name}" style="max-width: 100px; max-height: 100px; object-fit: contain; float: left; margin-right: 15px;">
        <div style="overflow: hidden;">
          <h3 style="margin-top: 0;"><a href="${url}" style="text-decoration: none; color: #111827;">${name}</a></h3>
          <p style="font-size: 1.1em;">
            <span style="text-decoration: line-through; color: #6b7280;">${currency} ${oldPrice}</span>
            <span style="color: #ef4444; font-weight: bold; margin-left: 10px;">${currency} ${newPrice}</span>
          </p>
          <p style="color: #059669; font-weight: bold;">You save ${currency} ${savings}!</p>
        </div>
        <div style="clear: both;"></div>
      </div>

      <p>Target Price was: ${currency} ${targetPrice}</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${url}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Deal</a>
      </div>

      <hr style="margin-top: 40px; border: none; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 0.8em; color: #9ca3af; text-align: center;">You are receiving this because you enabled alerts for this product on PriceTracker.</p>
    </div>
  `;

	return sendEmail({
		to: userEmail,
		subject,
		html,
		messageId: notificationId ? `<${notificationId}@pricetracker.local>` : undefined,
		idempotencyKey: notificationId ? `price-drop/${notificationId}` : undefined,
	});
}
