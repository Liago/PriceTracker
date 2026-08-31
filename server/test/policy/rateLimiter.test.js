import { describe, it, expect } from 'vitest';
import limiterModule from '../../scrape/policy/rateLimiter.js';

const { createRateLimiter } = limiterModule;

/** Orologio controllabile, per non dipendere dal tempo reale. */
function clock(start = 0) {
	let current = start;
	return { now: () => current, advance: (ms) => { current += ms; } };
}

describe('rateLimiter', () => {
	it('consente la prima richiesta a un dominio nuovo', () => {
		const limiter = createRateLimiter({ now: clock().now });
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
	});

	it('impone l\'intervallo minimo fra due richieste', () => {
		const time = clock();
		const limiter = createRateLimiter({ now: time.now, defaultMinIntervalMs: 10000 });

		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);

		const negata = limiter.tryAcquire('shop.it');
		expect(negata.allowed).toBe(false);
		expect(negata.waitMs).toBe(10000);

		time.advance(10000);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
	});

	it('dice quanto aspettare, cosi\' il chiamante riaccoda invece di scartare', () => {
		const time = clock();
		const limiter = createRateLimiter({ now: time.now, defaultMinIntervalMs: 10000 });
		limiter.tryAcquire('shop.it');
		time.advance(3000);

		expect(limiter.tryAcquire('shop.it').waitMs).toBe(7000);
	});

	it('esaurisce i gettoni e li ricarica col tempo', () => {
		const time = clock();
		const limiter = createRateLimiter({ now: time.now, defaultRpm: 3, defaultMinIntervalMs: 0 });

		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(false);

		time.advance(20000); // un gettone a 3 rpm
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
	});

	it('tiene i domini separati', () => {
		const limiter = createRateLimiter({ now: clock().now, defaultRpm: 1, defaultMinIntervalMs: 0 });

		expect(limiter.tryAcquire('shop-a.it').allowed).toBe(true);
		expect(limiter.tryAcquire('shop-a.it').allowed).toBe(false);
		// Un dominio non paga per l'altro.
		expect(limiter.tryAcquire('shop-b.it').allowed).toBe(true);
	});

	it('usa i limiti del profilo dominio quando ci sono', () => {
		const time = clock();
		const limiter = createRateLimiter({ now: time.now, defaultRpm: 6 });
		const profilo = { rate_limit_rpm: 60, min_interval_ms: 1000 };

		expect(limiter.tryAcquire('shop.it', profilo).allowed).toBe(true);
		time.advance(1000);
		expect(limiter.tryAcquire('shop.it', profilo).allowed).toBe(true);
	});

	it('una penalita\' azzera i gettoni e rispetta il Retry-After', () => {
		const time = clock();
		const limiter = createRateLimiter({ now: time.now, defaultRpm: 60, defaultMinIntervalMs: 0 });

		limiter.penalize('shop.it', 120);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(false);

		time.advance(60000);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(false); // Retry-After non ancora scaduto

		time.advance(61000);
		expect(limiter.tryAcquire('shop.it').allowed).toBe(true);
	});

	it('riporta lo stato dei bucket', () => {
		const limiter = createRateLimiter({ now: clock().now });
		limiter.tryAcquire('shop.it');
		expect(limiter.stats()[0].domain).toBe('shop.it');
	});
});
