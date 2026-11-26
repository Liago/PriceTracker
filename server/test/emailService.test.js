import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import service from '../services/emailService.js';

const KEYS = ['MAIL_PROVIDER', 'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_REPLY_TO', 'MAIL_FROM', 'SMTP_FROM'];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); KEYS.forEach(k => delete process.env[k]); });
afterEach(() => { KEYS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); });

const okFetch = (id = 'email-123') => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id }) });

describe('selezione del provider', () => {
	it('usa Resend quando RESEND_API_KEY e\' presente', () => {
		process.env.RESEND_API_KEY = 're_test';
		expect(service.mailProvider()).toBe('resend');
	});
	it('ricade su SMTP senza chiave Resend', () => {
		expect(service.mailProvider()).toBe('smtp');
	});
	it('rispetta MAIL_PROVIDER', () => {
		process.env.RESEND_API_KEY = 're_test';
		process.env.MAIL_PROVIDER = 'smtp';
		expect(service.mailProvider()).toBe('smtp');
	});
});

describe('invio con Resend', () => {
	it('invia via API con autenticazione e chiave di idempotenza', async () => {
		process.env.RESEND_API_KEY = 're_test';
		process.env.RESEND_FROM = 'PriceTracker <alerts@example.com>';
		process.env.RESEND_REPLY_TO = 'support@example.com';
		const fetchImpl = okFetch();
		const result = await service.sendWithResend({ to: 'user@example.com', subject: 'Ciao', html: '<p>x</p>', idempotencyKey: 'price-drop/n1' }, { fetchImpl });

		expect(result).toMatchObject({ provider: 'resend', id: 'email-123', accepted: ['user@example.com'] });
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer re_test', 'Idempotency-Key': 'price-drop/n1' });
		expect(JSON.parse(init.body)).toEqual({ from: 'PriceTracker <alerts@example.com>', to: ['user@example.com'], subject: 'Ciao', html: '<p>x</p>', reply_to: 'support@example.com' });
	});

	it('senza chiave lancia un errore, cosi\' l\'email resta in coda', async () => {
		await expect(service.sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl: okFetch() })).rejects.toThrow(/Resend non configurato/);
	});

	it('propaga il messaggio di errore restituito da Resend', async () => {
		process.env.RESEND_API_KEY = 're_test';
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ name: 'validation_error', message: 'The domain is not verified' }) });
		await expect(service.sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl })).rejects.toThrow('Resend ha rifiutato l\'email (403): The domain is not verified');
	});

	it('segnala gli errori di rete', async () => {
		process.env.RESEND_API_KEY = 're_test';
		const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
		await expect(service.sendWithResend({ to: 'a@b.c', subject: 's', html: 'h' }, { fetchImpl })).rejects.toThrow('Resend non raggiungibile: ECONNRESET');
	});
});
