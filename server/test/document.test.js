import { describe, it, expect } from 'vitest';
import documentModule from '../scrape/document.js';

const { createDocument, parseJsonLoosely, balancedSpan } = documentModule;

describe('balancedSpan', () => {
	it('estende un oggetto fino alla sua chiusura', () => {
		expect(balancedSpan('{"a":1}', 0)).toBe('{"a":1}');
		expect(balancedSpan('rumore {"a":{"b":2}} coda', 7)).toBe('{"a":{"b":2}}');
	});

	it('non si fa ingannare da parentesi dentro le stringhe', () => {
		// Una graffa dentro un valore testuale non deve chiudere l'oggetto.
		const conGraffa = '{"a":"}"}';
		expect(balancedSpan(conGraffa, 0)).toBe(conGraffa);

		// Nemmeno se preceduta da virgolette con escape.
		const conEscape = '{"a":"x\\"}y"}';
		expect(balancedSpan(conEscape, 0)).toBe(conEscape);
		expect(JSON.parse(conEscape)).toEqual({ a: 'x"}y' });
	});

	it('restituisce null se il valore non si chiude', () => {
		expect(balancedSpan('{"a":1', 0)).toBeNull();
		expect(balancedSpan('non una parentesi', 0)).toBeNull();
	});
});

describe('parseJsonLoosely', () => {
	it('parsa JSON pulito', () => {
		expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonLoosely('  [1,2]  ')).toEqual([1, 2]);
	});

	it('recupera JSON avvolto in CDATA e commenti', () => {
		// La parentesi quadra dentro "<![CDATA[" inganna un ritaglio ingenuo.
		expect(parseJsonLoosely('<!--//--><![CDATA[//><!--{"a":1}//--><!]]>')).toEqual({ a: 1 });
	});

	it('recupera JSON con virgola finale', () => {
		expect(parseJsonLoosely('{"a":1,}')).toEqual({ a: 1 });
		expect(parseJsonLoosely('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
	});

	it('restituisce undefined su input irrecuperabile', () => {
		expect(parseJsonLoosely('non json')).toBeUndefined();
		expect(parseJsonLoosely('')).toBeUndefined();
		expect(parseJsonLoosely('{"a":')).toBeUndefined();
	});
});

describe('ScrapeDocument', () => {
	const html = `<!doctype html><html><head>
		<title>  Titolo   della pagina </title>
		<link rel="canonical" href="https://shop.example.it/p/canonico">
		<meta property="og:title" content="Titolo OG">
		<meta name="description" content="Descrizione">
		<meta itemprop="price" content="729.00">
	</head><body>
		<h1 class="product-title">Prodotto</h1>
		<div class="price">  729,00   € </div>
		<img id="hero" src="https://shop.example.it/i.jpg">
	</body></html>`;

	const doc = createDocument(html, { url: 'https://shop.example.it/p?utm_source=x' });

	it('legge i meta per property, name e itemprop', () => {
		expect(doc.meta('og:title')).toBe('Titolo OG');
		expect(doc.meta('description')).toBe('Descrizione');
		expect(doc.meta('price')).toBe('729.00');
		expect(doc.meta('inesistente')).toBeNull();
	});

	it('normalizza gli spazi nel testo', () => {
		expect(doc.title()).toBe('Titolo   della pagina');
		expect(doc.text('.price')).toBe('729,00 €');
	});

	it('legge attributi e verifica la presenza di selettori', () => {
		expect(doc.attr('#hero', 'src')).toBe('https://shop.example.it/i.jpg');
		expect(doc.has('.product-title')).toBe(true);
		expect(doc.has('.non-esiste')).toBe(false);
		expect(doc.attr('#hero', 'data-assente')).toBeNull();
	});

	it('preferisce il canonical dichiarato all\'URL di provenienza', () => {
		expect(doc.canonicalUrl()).toBe('https://shop.example.it/p/canonico');
	});

	it('ricade sull\'URL di provenienza senza canonical', () => {
		const senza = createDocument('<html><head></head><body></body></html>', { url: 'https://x.it/p' });
		expect(senza.canonicalUrl()).toBe('https://x.it/p');
	});

	it('regge HTML vuoto o non stringa', () => {
		for (const input of ['', null, undefined, 42]) {
			const empty = createDocument(input);
			expect(empty.jsonLdBlocks()).toEqual([]);
			expect(empty.meta('og:title')).toBeNull();
		}
	});

	it('mette in cache i blocchi JSON-LD', () => {
		const cached = createDocument('<script type="application/ld+json">{"a":1}</script>');
		expect(cached.jsonLdBlocks()).toBe(cached.jsonLdBlocks());
	});
});
