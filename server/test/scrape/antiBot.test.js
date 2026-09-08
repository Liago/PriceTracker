import { describe, it, expect } from 'vitest';
import antiBotModule from '../../scrape/antiBot.js';

const { detectInHtml, titleOf } = antiBotModule;

/** Riempitivo, per portare una pagina sopra la soglia di plausibilita'. */
const bulk = (n = 4000) => '<p>' + 'contenuto '.repeat(n / 10) + '</p>';

describe('titleOf', () => {
	it('legge il titolo senza costruire un DOM', () => {
		expect(titleOf('<html><head><title>  iPad   Pro  </title></head>')).toBe('iPad Pro');
	});

	it('su una pagina senza titolo restituisce stringa vuota', () => {
		expect(titleOf('<html><body>ciao</body></html>')).toBe('');
	});
});

describe('detectInHtml - le sfide che tornano con status 200', () => {
	it('riconosce una challenge Cloudflare', () => {
		const html = '<html><head><title>Just a moment...</title></head>'
			+ '<body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>';
		const result = detectInHtml(html);

		expect(result.detected).toBe(true);
		expect(result.type).toBe('Cloudflare');
		expect(result.reason).toBe('pagina_di_sfida');
	});

	it('riconosce DataDome, che e’ quello che usano diversi marketplace', () => {
		const html = '<html><head><title>Verifica di sicurezza</title></head>'
			+ `<body><script src="https://geo.captcha-delivery.com/captcha/"></script>${bulk()}</body></html>`;
		const result = detectInHtml(html);

		expect(result.detected).toBe(true);
		expect(result.type).toBe('DataDome');
	});

	it('riconosce una sfida dal testo anche senza marcatore di fornitore', () => {
		const html = `<html><head><title>Attention Required!</title></head><body>${bulk()}</body></html>`;
		expect(detectInHtml(html).detected).toBe(true);
	});

	it('riconosce «enable javascript and cookies to continue»', () => {
		const html = `<html><head><title>x</title></head><body>Please enable JavaScript and cookies to continue${bulk()}</body></html>`;
		expect(detectInHtml(html).detected).toBe(true);
	});
});

describe('detectInHtml - cosa NON deve essere scambiato per una sfida', () => {
	it('una pagina prodotto vera, anche se il sito usa Cloudflare', () => {
		// Il marcatore c'e' - com'e' normale su chi usa quei servizi - ma la
		// pagina e' piena e il titolo e' quello del prodotto.
		const html = '<html><head><title>iPad Pro 2024 M4 - ricondizionato</title></head>'
			+ `<body><script src="/cdn-cgi/scripts/beacon.js"></script>${bulk()}</body></html>`;
		const result = detectInHtml(html);

		expect(result.detected).toBe(false);
		expect(result.reason).toBeNull();
	});

	it('una pagina piccola senza marcatori non e’ una sfida, ma lo dice', () => {
		const result = detectInHtml('<html><head><title>Vuoto</title></head><body></body></html>');

		expect(result.detected).toBe(false);
		expect(result.reason).toBe('pagina_troppo_piccola');
	});

	it('riporta sempre byte e titolo, che sono la prima cosa da guardare', () => {
		const html = `<html><head><title>Prodotto</title></head><body>${bulk()}</body></html>`;
		const result = detectInHtml(html);

		expect(result.bytes).toBeGreaterThan(2048);
		expect(result.title).toBe('Prodotto');
	});
});
