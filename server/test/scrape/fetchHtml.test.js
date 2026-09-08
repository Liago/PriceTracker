import { describe, it, expect } from 'vitest';
import fetchHtmlModule from '../../scrape/fetchHtml.js';

const { fetchHtml, decodeHtml, SKIP } = fetchHtmlModule;

/** Risposta finta, con la superficie di Response che fetchHtml usa davvero. */
function fakeResponse({ status = 200, headers = {}, body = '', encoding = 'utf8' } = {}) {
	const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	const chunks = body === null ? null : [Buffer.from(body, encoding)];

	return {
		status,
		headers: { get: (name) => lower[name.toLowerCase()] ?? null },
		body: chunks === null ? null : (async function* () { yield* chunks; })(),
	};
}

/** checkUrl finto: ammette tutto tranne gli host elencati. */
const allowAll = (blocked = []) => async (url) => {
	const parsed = new URL(url);
	if (blocked.includes(parsed.hostname)) {
		return { allowed: false, reason: 'indirizzo_non_pubblico' };
	}
	return { allowed: true, url: parsed.toString(), hostname: parsed.hostname };
};

const PAGE = '<html><head><title>iPad Pro</title></head><body>ok</body></html>';
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

describe('fetchHtml - il percorso normale', () => {
	it('restituisce l’HTML di una risposta 200', async () => {
		const result = await fetchHtml('https://shop.it/p/1', {
			fetchImpl: async () => fakeResponse({ headers: HTML_HEADERS, body: PAGE }),
			checkUrlImpl: allowAll(),
		});

		expect(result.ok).toBe(true);
		expect(result.html).toBe(PAGE);
		expect(result.status).toBe(200);
	});

	it('manda header da browser: senza, molti shop servono un’altra pagina', async () => {
		let seen = null;
		await fetchHtml('https://shop.it/p/1', {
			fetchImpl: async (url, init) => { seen = init; return fakeResponse({ headers: HTML_HEADERS, body: PAGE }); },
			checkUrlImpl: allowAll(),
		});

		expect(seen.headers['User-Agent']).toMatch(/Mozilla/);
		expect(seen.headers['Accept-Language']).toContain('it-IT');
		expect(seen.redirect).toBe('manual');
	});
});

describe('fetchHtml - i redirect, che sono il punto della difesa da SSRF', () => {
	it('segue un redirect e rivalida la destinazione', async () => {
		const visited = [];
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async (url) => {
				visited.push(url);
				if (visited.length === 1) {
					return fakeResponse({ status: 302, headers: { location: 'https://shop.it/p/finale' } });
				}
				return fakeResponse({ headers: HTML_HEADERS, body: PAGE });
			},
			checkUrlImpl: allowAll(),
		});

		expect(result.ok).toBe(true);
		expect(visited).toEqual(['https://shop.it/p', 'https://shop.it/p/finale']);
	});

	it('risolve una Location relativa contro l’URL corrente', async () => {
		const visited = [];
		await fetchHtml('https://shop.it/it/p', {
			fetchImpl: async (url) => {
				visited.push(url);
				if (visited.length === 1) return fakeResponse({ status: 301, headers: { location: '/it/p/finale' } });
				return fakeResponse({ headers: HTML_HEADERS, body: PAGE });
			},
			checkUrlImpl: allowAll(),
		});

		expect(visited[1]).toBe('https://shop.it/it/p/finale');
	});

	it('rifiuta un redirect verso un indirizzo interno', async () => {
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
			checkUrlImpl: allowAll(['169.254.169.254']),
		});

		expect(result.ok).toBe(false);
		expect(result.reason).toBe(SKIP.POLICY);
	});

	it('si ferma dopo troppi redirect', async () => {
		let hops = 0;
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => {
				hops++;
				return fakeResponse({ status: 302, headers: { location: `https://shop.it/p/${hops}` } });
			},
			checkUrlImpl: allowAll(),
		});

		expect(result.ok).toBe(false);
		expect(result.reason).toBe(SKIP.REDIRECT_LOOP);
	});
});

describe('fetchHtml - quando rinunciare e lasciare il posto al browser', () => {
	it('un 403 e’ un anti-bot, non un errore', async () => {
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => fakeResponse({ status: 403 }),
			checkUrlImpl: allowAll(),
		});

		expect(result.ok).toBe(false);
		expect(result.reason).toBe(SKIP.BLOCKED);
		expect(result.antiBotSuspected).toBe(true);
	});

	it('un 429 pure', async () => {
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => fakeResponse({ status: 429 }),
			checkUrlImpl: allowAll(),
		});
		expect(result.antiBotSuspected).toBe(true);
	});

	it('un 404 non e’ un anti-bot', async () => {
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => fakeResponse({ status: 404 }),
			checkUrlImpl: allowAll(),
		});

		expect(result.reason).toBe(SKIP.HTTP_ERROR);
		expect(result.antiBotSuspected).toBeFalsy();
	});

	it('rifiuta cio’ che non e’ una pagina', async () => {
		const result = await fetchHtml('https://shop.it/p.pdf', {
			fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'application/pdf' }, body: '%PDF' }),
			checkUrlImpl: allowAll(),
		});

		expect(result.reason).toBe(SKIP.NOT_HTML);
	});

	it('tronca una risposta troppo grande invece di riempire la memoria', async () => {
		const huge = 'x'.repeat(6 * 1024 * 1024);
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => fakeResponse({ headers: HTML_HEADERS, body: huge }),
			checkUrlImpl: allowAll(),
		});

		expect(result.reason).toBe(SKIP.TOO_LARGE);
	});

	it('un timeout e’ un timeout, non un errore di rete', async () => {
		const result = await fetchHtml('https://shop.it/p', {
			fetchImpl: async () => { const e = new Error('The operation was aborted'); e.name = 'TimeoutError'; throw e; },
			checkUrlImpl: allowAll(),
		});

		expect(result.reason).toBe(SKIP.TIMEOUT);
	});

	it('un URL non ammesso non viene nemmeno richiesto', async () => {
		let called = false;
		const result = await fetchHtml('http://localhost:5432/', {
			fetchImpl: async () => { called = true; return fakeResponse(); },
			checkUrlImpl: async () => ({ allowed: false, reason: 'indirizzo_non_pubblico' }),
		});

		expect(called).toBe(false);
		expect(result.reason).toBe(SKIP.POLICY);
	});
});

describe('decodeHtml', () => {
	it('rispetta il charset dichiarato, cosi’ gli accenti sopravvivono', () => {
		const latin1 = Buffer.from('Città', 'latin1');
		expect(decodeHtml(latin1, 'text/html; charset=iso-8859-1')).toBe('Città');
	});

	it('senza charset assume utf-8', () => {
		expect(decodeHtml(Buffer.from('Città', 'utf8'), 'text/html')).toBe('Città');
	});

	it('su un charset sconosciuto ripiega su utf-8 invece di fallire', () => {
		expect(decodeHtml(Buffer.from('ok', 'utf8'), 'text/html; charset=inventato-1')).toBe('ok');
	});
});
