import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mailProvider, sendWithResend } from '../services/emailService.mts';

const KEYS = ['MAIL_PROVIDER', 'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_REPLY_TO', 'MAIL_FROM', 'SMTP_FROM'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string>>;

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
	KEYS.forEach(key => delete process.env[key]);
});
afterEach(() => {
	KEYS.forEach(key => {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	});
});

const jsonResponse = (status: number, body: unknown, statusText = ''): Response =>
	({ ok: status >= 200 && status < 300, status, statusText, json: async () => body }) as Response;

const okFetch = (id = 'email-123') => vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { id }));

describe('selezione del provider', () => {
	it("usa Resend quando RESEND_API_KEY e' presente", () => {
		process.env.RESEND_API_KEY = 're_test';
		expect(mailProvider()).toBe('resend');
	});
	it('ricade su SMTP senza chiave Resend', () => {
		expect(mailProvider()).toBe('smtp');
	});
	it('rispetta MAIL_PROVIDER', () => {
		process.env.RESEND_API_KEY = 're_test';
		process.env.MAIL_PROVIDER = 'smtp';
		expect(mailProvider()).toBe('smtp');
	});
});

describe('invio con Resend', () => {
	it('invia via API con autenticazione e chiave di idempotenza', async () => {
		process.env.RESEND_API_KEY = 're_test';
		process.env.RESEND_FROM = 'PriceTracker <alerts@example.com>';
		process.env.RESEND_REPLY_TO = 'support@example.com';
		const fetchImpl = okFetch();
		const result = await sendWithResend(
			{ to: 'user@example.com', subject: 'Ciao', html: '<p>x</p>', idempotencyKey: 'price-drop/n1' },
			{ fetchImpl },
		);

		expect(result).toEqual({ provider: 'resend', messageId: 'email-123', accepted: ['user@example.com'] });
		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(url).toBe('https://api.resend.com/emails');
		expect(init?.headers).toMatchObject({ Authorization: 'Bearer re_test', 'Idempotency-Key': 'price-drop/n1' });
		expect(JSON.parse(String(init?.body))).toEqual({
			from: 'PriceTracker <alerts@example.com>',
			to: ['user@example.com'],
			subject: 'Ciao',
			html: '<p>x</p>',
			reply_to: 'support@example.com',
		});
	});

	it("senza chiave lancia un errore, cosi' l'email resta in coda", async () => {
		await expect(sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl: okFetch() })).rejects.toThrow(
			/Resend non configurato/,
		);
	});

	it('propaga il messaggio di errore restituito da Resend', async () => {
		process.env.RESEND_API_KEY = 're_test';
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse(403, { name: 'validation_error', message: 'The domain is not verified' }, 'Forbidden'));
		await expect(sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl })).rejects.toThrow(
			"Resend ha rifiutato l'email (403): The domain is not verified",
		);
	});

	it('segnala gli errori di rete', async () => {
		process.env.RESEND_API_KEY = 're_test';
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNRESET'));
		await expect(sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl })).rejects.toThrow(
			'Resend non raggiungibile: ECONNRESET',
		);
	});
});
