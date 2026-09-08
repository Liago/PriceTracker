import { describe, it, expect } from 'vitest';
import express from 'express';
import serverless from 'serverless-http';
import jsonBodyModule from '../../api/jsonBody.js';

const { jsonBody, isJsonRequest, decodeBody } = jsonBodyModule;

/** Esegue il middleware su una richiesta finta e riferisce cosa e' successo. */
function run(req) {
	const middleware = jsonBody();
	const result = { next: false, status: null, payload: null };
	const res = {
		status(code) { result.status = code; return this; },
		json(payload) { result.payload = payload; return this; },
	};
	middleware(req, res, () => { result.next = true; });
	return result;
}

const jsonHeaders = { 'content-type': 'application/json' };

describe('isJsonRequest', () => {
	it('riconosce i content-type JSON, con e senza parametri', () => {
		expect(isJsonRequest({ headers: { 'content-type': 'application/json' } })).toBe(true);
		expect(isJsonRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } })).toBe(true);
		expect(isJsonRequest({ headers: { 'content-type': 'application/merge-patch+json' } })).toBe(true);
	});

	it('lascia stare tutto il resto', () => {
		expect(isJsonRequest({ headers: { 'content-type': 'text/plain' } })).toBe(false);
		expect(isJsonRequest({ headers: { 'content-type': 'multipart/form-data; boundary=x' } })).toBe(false);
		expect(isJsonRequest({ headers: {} })).toBe(false);
		expect(isJsonRequest({})).toBe(false);
	});
});

describe('decodeBody', () => {
	it('rispetta il charset dichiarato', () => {
		const req = { headers: { 'content-type': 'application/json; charset=utf-16le' } };
		expect(decodeBody(Buffer.from('{"a":1}', 'utf16le'), req)).toBe('{"a":1}');
	});

	it('rifiuta le codifiche che non sono utf-*', () => {
		const req = { headers: { 'content-type': 'application/json; charset=iso-8859-1' } };
		expect(decodeBody(Buffer.from('{}'), req)).toBeNull();
	});
});

describe('jsonBody - il body grezzo diventa un oggetto', () => {
	it('interpreta un Buffer lasciato da serverless-http', () => {
		const req = {
			headers: jsonHeaders,
			body: Buffer.from(JSON.stringify({ url: 'https://www.backmarket.it/it-it/p/ipad' })),
		};
		const result = run(req);

		expect(result.next).toBe(true);
		expect(req.body).toEqual({ url: 'https://www.backmarket.it/it-it/p/ipad' });
	});

	it('interpreta anche una stringa', () => {
		const req = { headers: jsonHeaders, body: '{"url":"https://shop.it/p"}' };
		run(req);
		expect(req.body).toEqual({ url: 'https://shop.it/p' });
	});

	it("non tocca un body gia' parsato da express.json()", () => {
		const parsed = { url: 'https://shop.it/p', targetPrice: 10 };
		const req = { headers: jsonHeaders, body: parsed };
		run(req);
		expect(req.body).toBe(parsed);
	});

	it('un body assente su richiesta JSON diventa un oggetto vuoto', () => {
		const req = { headers: jsonHeaders, body: undefined };
		run(req);
		expect(req.body).toEqual({});
	});

	it('un body vuoto diventa un oggetto vuoto', () => {
		const req = { headers: jsonHeaders, body: Buffer.from('   ') };
		run(req);
		expect(req.body).toEqual({});
	});

	it("un JSON che non e' un oggetto non porta campi", () => {
		const req = { headers: jsonHeaders, body: Buffer.from('"ciao"') };
		run(req);
		expect(req.body).toEqual({});
	});

	it('lascia intatto un body non JSON', () => {
		const raw = Buffer.from('campo=valore');
		const req = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: raw };
		const result = run(req);

		expect(result.next).toBe(true);
		expect(req.body).toBe(raw);
	});

	it("un JSON malformato e' un 400, non un url mancante", () => {
		const req = { headers: jsonHeaders, body: Buffer.from('{"url":') };
		const result = run(req);

		expect(result.next).toBe(false);
		expect(result.status).toBe(400);
		expect(result.payload.code).toBe('INVALID_JSON');
	});

	it("una codifica non supportata e' un 415", () => {
		const req = { headers: { 'content-type': 'application/json; charset=iso-8859-1' }, body: Buffer.from('{}') };
		const result = run(req);

		expect(result.status).toBe(415);
		expect(result.payload.code).toBe('UNSUPPORTED_CHARSET');
	});
});

/**
 * Il test che conta: la combinazione reale.
 *
 * Non verifica il nostro codice in isolamento ma l'incontro fra serverless-http
 * ed Express 5, che e' il punto dove il difetto e' nato. Se una versione futura
 * di una delle due librerie cambia comportamento, e' qui che si vede.
 */
describe('POST su Netlify - il body arriva alle route', () => {
	/** Riproduce l'evento che Netlify passa alla function. */
	const netlifyEvent = (path, body) => ({
		httpMethod: 'POST',
		path,
		headers: { 'content-type': 'application/json', host: 'pricetracker.netlify.app' },
		queryStringParameters: {},
		requestContext: { identity: { sourceIp: '203.0.113.10' } },
		body: JSON.stringify(body),
		isBase64Encoded: false,
	});

	const buildHandler = (withFix) => {
		const app = express();
		app.use(express.json());

		const router = express.Router();
		if (withFix) router.use(jsonBody());
		router.post('/products', (req, res) => {
			const { url } = req.body || {};
			if (!url) return res.status(400).json({ error: 'URL non ammesso: url_mancante' });
			return res.status(201).json({ url });
		});
		app.use('/api', router);

		return serverless(app);
	};

	const BACKMARKET = 'https://www.backmarket.it/it-it/p/ipad-pro-2024-m4-series';

	it("senza il middleware il body resta un Buffer: e' il difetto di staging", async () => {
		const handler = buildHandler(false);
		const response = await handler(netlifyEvent('/api/products', { url: BACKMARKET }), {});

		expect(response.statusCode).toBe(400);
		expect(JSON.parse(response.body).error).toContain('url_mancante');
	});

	it('con il middleware la route riceve i suoi campi', async () => {
		const handler = buildHandler(true);
		const response = await handler(netlifyEvent('/api/products', { url: BACKMARKET }), {});

		expect(response.statusCode).toBe(201);
		expect(JSON.parse(response.body)).toEqual({ url: BACKMARKET });
	});

	it('anche con il body codificato in base64, come fa Netlify', async () => {
		const handler = buildHandler(true);
		const event = netlifyEvent('/api/products', { url: 'https://shop.it/p' });
		event.body = Buffer.from(event.body, 'utf8').toString('base64');
		event.isBase64Encoded = true;

		const response = await handler(event, {});

		expect(response.statusCode).toBe(201);
		expect(JSON.parse(response.body)).toEqual({ url: 'https://shop.it/p' });
	});
});
