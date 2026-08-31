import { describe, it, expect } from 'vitest';
import validation from '../utils/validation.js';

const { validateProductUrl, sanitizeInput } = validation;

// Nessuna variabile Supabase e' impostata in test: validateProductUrl ricade
// sulla whitelist statica. E' il comportamento che la fase 5 sostituira' con
// urlPolicy + domain_profiles; qui lo fissiamo per accorgerci se cambia prima.

describe('validateProductUrl', () => {
	it('accetta un dominio in whitelist e normalizza l\'URL', async () => {
		await expect(validateProductUrl('https://www.amazon.it/dp/B0TEST'))
			.resolves.toBe('https://www.amazon.it/dp/B0TEST');
	});

	it('rifiuta un input non stringa', async () => {
		await expect(validateProductUrl(null)).rejects.toThrow('non-empty string');
		await expect(validateProductUrl(42)).rejects.toThrow('non-empty string');
		await expect(validateProductUrl('')).rejects.toThrow('non-empty string');
	});

	it('rifiuta un URL malformato', async () => {
		await expect(validateProductUrl('non-un-url')).rejects.toThrow('Invalid URL format');
	});

	it('rifiuta protocolli diversi da http/https', async () => {
		await expect(validateProductUrl('file:///etc/passwd')).rejects.toThrow('HTTP or HTTPS');
		await expect(validateProductUrl('ftp://amazon.it/x')).rejects.toThrow('HTTP or HTTPS');
	});

	it('rifiuta un dominio fuori whitelist', async () => {
		await expect(validateProductUrl('https://negozio-sconosciuto.it/prodotto'))
			.rejects.toThrow("Domain 'negozio-sconosciuto.it' is not supported");
	});

	it('rifiuta un sottodominio non elencato di un dominio elencato', async () => {
		// La whitelist confronta l'hostname esatto: smoke test del confine.
		await expect(validateProductUrl('https://evil.amazon.it.attacker.com/x'))
			.rejects.toThrow('is not supported');
	});
});

describe('sanitizeInput', () => {
	it('rimuove i tag HTML', () => {
		expect(sanitizeInput('<b>ciao</b>')).toBe('ciao');
		expect(sanitizeInput('<script>alert(1)</script>x')).toBe('alert(1)x');
	});

	it('lascia intatto un input non stringa', () => {
		expect(sanitizeInput(42)).toBe(42);
		expect(sanitizeInput(null)).toBe(null);
	});
});
