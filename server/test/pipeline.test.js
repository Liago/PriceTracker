import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pipelineModule from '../scrape/pipeline.js';

const { runPipeline } = pipelineModule;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', 'generic', name), 'utf-8');
const run = (name, options) => runPipeline(fixture(name), { url: 'https://shop.example.it/p', ...options });

describe('pipeline - shop con dati strutturati', () => {
	const out = run('shopify-like.html');

	it('estrae il prezzo corretto con alta confidenza', () => {
		expect(out.result.price).toBe(149);
		expect(out.result.currency).toBe('EUR');
		expect(out.confidence).toBeGreaterThanOrEqual(0.85);
	});

	it('non si fa ingannare dal prezzo barrato, dal carrello o dai correlati', () => {
		// Nella pagina compaiono anche 199,00 (barrato), 0,00 (carrello in nav),
		// 59,00 (soglia spedizione), 39,00 e 89,00 (prodotti correlati).
		expect(out.result.price).toBe(149);
	});

	it('preferisce una sorgente strutturata al DOM', () => {
		expect(['platform', 'jsonld', 'appstate', 'microdata']).toContain(out.fields.price.source);
	});

	it('l\'adapter di piattaforma vince sulle altre sorgenti strutturate', () => {
		// La fixture e' una pagina Shopify: l'adapter legge il prodotto
		// dall'oggetto che la piattaforma stessa espone, varianti comprese, e
		// per questo pesa piu' del JSON-LD.
		expect(out.fields.price.source).toBe('platform');
	});

	it('registra quali estrattori hanno girato e quanti candidati hanno prodotto', () => {
		const names = out.extractorsRan.map((e) => e.name);
		expect(names).toEqual(['platform', 'jsonld', 'appstate', 'microdata', 'meta', 'dom']);
		expect(out.extractorsRan.every((e) => e.error === null)).toBe(true);
		expect(out.extractorsRan.find((e) => e.name === 'jsonld').candidates).toBeGreaterThan(0);
	});

	it('estrae anche identita\' e disponibilita\'', () => {
		expect(out.result.title).toContain('Zaino da Viaggio');
		expect(out.result.sku).toBe('ZV35-NERO');
		expect(out.result.brand).toBe('Bottega Alpina');
		expect(out.result.availability).toBe('in_stock');
	});
});

describe('pipeline - shop artigianale senza dati strutturati', () => {
	const out = run('artisanal-no-structured-data.html');

	it('trova comunque il prezzo giusto', () => {
		// Nessun JSON-LD, nessun microdata, nessun meta: solo il DOM. Nella
		// pagina ci sono anche 59,00 barrato, 6,90 di spedizione e 5,00 di buono.
		expect(out.result.price).toBe(44.5);
	});

	it('resta sotto la soglia di accettazione automatica', () => {
		// Il solo DOM non deve mai bastare per fidarsi senza conferme.
		expect(out.fields.price.source).toBe('dom');
		expect(out.confidence).toBeLessThan(0.85);
	});

	it('spiega su quali segnali si e\' basato', () => {
		expect(out.fields.price.meta.signals).toContain('sconto-su-barrato');
		expect(out.fields.price.evidence).toContain('44,50');
	});
});

describe('pipeline - sorgenti in conflitto', () => {
	const out = run('conflicting-sources.html');

	it('sceglie la sorgente piu\' affidabile', () => {
		// JSON-LD 149, meta 199, DOM 129: vince il JSON-LD.
		expect(out.result.price).toBe(149);
		expect(out.fields.price.source).toBe('jsonld');
	});

	it('non alza la confidenza: le sorgenti non concordano', () => {
		const concorde = run('shopify-like.html').confidence;
		expect(out.confidence).toBeLessThan(concorde);
	});
});

describe('pipeline - pagina che non e\' una scheda prodotto', () => {
	const out = run('not-a-product-page.html');

	it('penalizza la confidenza segnalando il sospetto', () => {
		// Una pagina di categoria ha prezzi ma non un prodotto: senza titolo
		// prodotto ne' immagine la confidenza deve crollare.
		expect(out.signals).toContain('non-sembra-una-scheda-prodotto');
		expect(out.confidence).toBeLessThan(0.6);
	});
});

describe('pipeline - robustezza', () => {
	it('regge HTML vuoto senza sollevare eccezioni', () => {
		const out = runPipeline('', { url: 'https://x.it/p' });
		expect(out.result.price).toBeUndefined();
		expect(out.confidence).toBe(0);
		expect(out.signals).toContain('nessun-prezzo');
	});

	it('regge HTML non valido', () => {
		const out = runPipeline('<html><body><div>non chiuso', { url: 'https://x.it/p' });
		expect(out.confidence).toBe(0);
	});

	it('un estrattore che fallisce non ferma gli altri', () => {
		// Si verifica il contratto: ogni estrattore riporta il proprio errore
		// e la pipeline prosegue.
		const out = run('shopify-like.html');
		expect(out.extractorsRan).toHaveLength(6);
		expect(out.result.price).toBe(149);
	});

	it('penalizza la confidenza quando c\'e\' un segnale anti-bot', () => {
		const pulito = run('shopify-like.html').confidence;
		const bloccato = run('shopify-like.html', { antiBotDetected: true });
		expect(bloccato.confidence).toBeLessThan(pulito);
		expect(bloccato.signals).toContain('anti-bot');
	});

	it('misura la durata di ogni estrattore', () => {
		const out = run('shopify-like.html');
		expect(out.durationMs).toBeGreaterThanOrEqual(0);
		expect(out.extractorsRan.every((e) => typeof e.durationMs === 'number')).toBe(true);
	});
});
