import { describe, it, expect } from 'vitest';
import robotsModule from '../../scrape/policy/robots.js';

const { parseRobots, isAllowed, matchesPattern, fetchRobots } = robotsModule;

const check = (text, path, agent) => isAllowed(parseRobots(text), path, agent);

describe('matchesPattern', () => {
	it('confronta per prefisso', () => {
		expect(matchesPattern('/admin', '/admin/utenti')).toBe(true);
		expect(matchesPattern('/admin', '/pubblico')).toBe(false);
	});

	it('supporta il jolly', () => {
		expect(matchesPattern('/*.pdf', '/documenti/listino.pdf')).toBe(true);
		expect(matchesPattern('/p/*/recensioni', '/p/123/recensioni')).toBe(true);
	});

	it('supporta l\'ancora di fine', () => {
		expect(matchesPattern('/p$', '/p')).toBe(true);
		expect(matchesPattern('/p$', '/p/123')).toBe(false);
	});

	it('un Disallow vuoto non vieta nulla', () => {
		expect(matchesPattern('', '/qualsiasi')).toBe(false);
	});
});

describe('isAllowed', () => {
	it('consente tutto quando non ci sono regole', () => {
		expect(check('', '/p/1').allowed).toBe(true);
		expect(check('# solo un commento', '/p/1').allowed).toBe(true);
	});

	it('applica un Disallow generico', () => {
		const robots = 'User-agent: *\nDisallow: /admin';
		expect(check(robots, '/admin/x').allowed).toBe(false);
		expect(check(robots, '/prodotti/1').allowed).toBe(true);
	});

	it('vince la regola con il pattern piu\' lungo', () => {
		const robots = 'User-agent: *\nDisallow: /p\nAllow: /p/pubblico';
		expect(check(robots, '/p/privato').allowed).toBe(false);
		expect(check(robots, '/p/pubblico/1').allowed).toBe(true);
	});

	it('a parita\' di lunghezza vince Allow', () => {
		const robots = 'User-agent: *\nDisallow: /p\nAllow: /p';
		expect(check(robots, '/p/1').allowed).toBe(true);
	});

	it('il gruppo specifico ha la precedenza su quello generico', () => {
		const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: PriceTrackerBot\nDisallow: /admin';
		expect(check(robots, '/prodotti/1', 'PriceTrackerBot').allowed).toBe(true);
		expect(check(robots, '/admin', 'PriceTrackerBot').allowed).toBe(false);
		expect(check(robots, '/prodotti/1', 'AltroBot').allowed).toBe(false);
	});

	it('piu\' User-agent consecutivi condividono le regole', () => {
		const robots = 'User-agent: BotA\nUser-agent: BotB\nDisallow: /x';
		expect(check(robots, '/x', 'BotA').allowed).toBe(false);
		expect(check(robots, '/x', 'BotB').allowed).toBe(false);
	});

	it('ignora i commenti a fine riga', () => {
		expect(check('User-agent: *\nDisallow: /admin # area riservata', '/admin').allowed).toBe(false);
	});

	it('espone il crawl-delay dichiarato', () => {
		expect(check('User-agent: *\nCrawl-delay: 10\nDisallow:', '/p').crawlDelay).toBe(10);
	});
});

describe('fetchRobots', () => {
	it('interpreta un robots scaricato', async () => {
		const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /admin' });
		const robots = await fetchRobots('https://shop.it', { fetchImpl });

		expect(robots.allowedFor('/admin').allowed).toBe(false);
		expect(robots.allowedFor('/p/1').allowed).toBe(true);
	});

	it('consente tutto se robots.txt non esiste', async () => {
		// 404 significa "nessuna regola", non "vietato".
		const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '' });
		const robots = await fetchRobots('https://shop.it', { fetchImpl });
		expect(robots.allowedFor('/qualsiasi').allowed).toBe(true);
	});

	it('consente tutto se la rete fallisce', async () => {
		const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
		const robots = await fetchRobots('https://shop.it', { fetchImpl });
		expect(robots.allowedFor('/qualsiasi').allowed).toBe(true);
		expect(robots.status).toBeNull();
	});
});
