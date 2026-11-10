import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import productInfo from '../../scrape/extract/productInfo.js';
import scrape from '../../scrape/index.js';

const { createDocument } = documentModule;
const { extractProductInfo, hasProductInfo, htmlToText, parseNumber, LIMITS } = productInfo;

const doc = (body, head = '', url = 'https://shop.example.it/p/1') =>
	createDocument(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, { url });
const ld = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe('productInfo - JSON-LD', () => {
	const product = {
		'@context': 'https://schema.org',
		'@type': 'Product',
		name: 'Robot aspirapolvere X1',
		description: '<p>Aspira e lava.</p><ul><li>Mappatura laser</li><li>Base autosvuotante</li></ul>',
		model: 'X1-2026',
		mpn: 'RX1',
		color: 'Nero',
		weight: { '@type': 'QuantitativeValue', value: 3.2, unitText: 'kg' },
		category: 'Casa > Pulizia > Robot',
		additionalProperty: [
			{ '@type': 'PropertyValue', name: 'Potenza di aspirazione', value: 8000, unitText: 'Pa' },
			{ '@type': 'PropertyValue', name: 'Autonomia', value: '180 min' },
		],
		aggregateRating: { '@type': 'AggregateRating', ratingValue: '4,6', reviewCount: '1.234' },
		offers: { '@type': 'Offer', price: '499.00', priceCurrency: 'EUR' },
	};
	const breadcrumbs = {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{ '@type': 'ListItem', position: 2, name: 'Pulizia' },
			{ '@type': 'ListItem', position: 1, name: 'Home' },
			{ '@type': 'ListItem', position: 3, item: { name: 'Robot aspirapolvere' } },
		],
	};

	it('legge specifiche, valutazione, categoria e breadcrumb', () => {
		const info = extractProductInfo(doc('', ld(product) + ld(breadcrumbs)), { title: product.name });

		expect(info.specs).toEqual(expect.arrayContaining([
			{ name: 'Potenza di aspirazione', value: '8000 Pa' },
			{ name: 'Autonomia', value: '180 min' },
			{ name: 'Modello', value: 'X1-2026' },
			{ name: 'Codice produttore', value: 'RX1' },
			{ name: 'Colore', value: 'Nero' },
			{ name: 'Peso', value: '3.2 kg' },
		]));
		expect(info.rating).toEqual({ value: 4.6, count: 1234, best: 5 });
		expect(info.breadcrumbs).toEqual(['Pulizia', 'Robot aspirapolvere']);
		expect(info.category).toBe('Robot');
	});

	it('converte la descrizione HTML in testo con paragrafi ed elenchi', () => {
		const info = extractProductInfo(doc('', ld(product)));
		expect(info.description).toBe('Aspira e lava.\n• Mappatura laser\n• Base autosvuotante');
	});

	it('ignora i Product ambigui invece di attribuire i dati sbagliati', () => {
		const other = { ...product, name: 'Altro', additionalProperty: [{ name: 'Colore', value: 'Rosso' }] };
		const info = extractProductInfo(doc('', ld([{ ...product }, other])));
		expect(info.specs).toEqual([]);
	});
});

describe('productInfo - Amazon', () => {
	const page = `
		<div id="dp"><span id="productTitle">Cuffie Wireless</span>
		<div id="feature-bullets"><ul>
			<li><span class="a-list-item"> Cancellazione attiva del rumore </span></li>
			<li><span class="a-list-item">Autonomia fino a 30 ore</span></li>
			<li class="aok-hidden"><span class="a-list-item">nascosto</span></li>
		</ul></div>
		<div id="productOverview_feature_div"><table>
			<tr><td><span>Marchio</span></td><td><span>Sonix</span></td></tr>
			<tr><td><span>Colore</span></td><td><span>Nero</span></td></tr>
		</table></div>
		<table id="productDetails_techSpec_section_1">
			<tr><th> Peso articolo </th><td>&lrm;250 g</td></tr>
			<tr><th>Recensioni dei clienti</th><td>4,4 su 5 stelle</td></tr>
		</table>
		<div id="detailBullets_feature_div"><ul>
			<li><span class="a-list-item"><span class="a-text-bold">Numero modello articolo &rlm; : &lrm;</span><span>WH-100</span></span></li>
			<li><span class="a-list-item"><span class="a-text-bold">Colore &rlm; : &lrm;</span><span>Blu</span></span></li>
		</ul></div>
		<span id="acrPopover" title="4,4 su 5 stelle"></span>
		<span id="acrCustomerReviewText">12.345 valutazioni</span>
		<div id="productDescription"><p>Cuffie pensate per viaggiare.</p><p>Custodia inclusa.</p></div>
		<div id="wayfinding-breadcrumbs_feature_div"><ul><li><a>Elettronica</a></li><li><a>Cuffie</a></li></ul></div>
		</div>`;

	it('legge punti elenco, tabelle, dettagli, valutazione e descrizione', () => {
		const info = extractProductInfo(doc(page, '', 'https://www.amazon.it/dp/B000000001'));

		expect(info.features).toEqual(['Cancellazione attiva del rumore', 'Autonomia fino a 30 ore']);
		expect(info.specs).toEqual([
			{ name: 'Marchio', value: 'Sonix' },
			{ name: 'Colore', value: 'Nero' },
			{ name: 'Peso articolo', value: '250 g' },
			{ name: 'Numero modello articolo', value: 'WH-100' },
		]);
		expect(info.rating).toEqual({ value: 4.4, count: 12345, best: 5 });
		expect(info.description).toBe('Cuffie pensate per viaggiare.\nCustodia inclusa.');
		expect(info.breadcrumbs).toEqual(['Elettronica', 'Cuffie']);
		expect(info.category).toBe('Cuffie');
	});
});

describe('productInfo - DOM generico', () => {
	it('legge una tabella di specifiche e una lista di caratteristiche', () => {
		const page = `
			<header><nav><table><tr><th>Menu</th><td>x</td></tr><tr><th>Menu2</th><td>y</td></tr></table></nav></header>
			<section class="product-features"><ul><li>Telaio in alluminio</li><li>Cambio a 21 velocità</li></ul></section>
			<div id="scheda-tecnica"><h3>Scheda tecnica</h3><table>
				<tr><th>Ruote</th><td>28"</td></tr>
				<tr><th>Peso</th><td>12 kg</td></tr>
			</table></div>
			<div class="specs"><dl><dt>Garanzia</dt><dd>2 anni</dd></dl></div>
			<div class="product-description"><p>Una bicicletta da città leggera e robusta, adatta ai percorsi di tutti i giorni.</p></div>`;
		const info = extractProductInfo(doc(page));

		expect(info.features).toEqual(['Telaio in alluminio', 'Cambio a 21 velocità']);
		expect(info.specs).toEqual([
			{ name: 'Ruote', value: '28"' },
			{ name: 'Peso', value: '12 kg' },
			{ name: 'Garanzia', value: '2 anni' },
		]);
		expect(info.description).toMatch(/^Una bicicletta da città/);
	});

	it('scarta le liste di link e le tabelle che non sono coppie nome/valore', () => {
		const page = `
			<div class="features"><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></div>
			<div class="specs"><table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table></div>`;
		const info = extractProductInfo(doc(page));
		expect(info.features).toEqual([]);
		expect(info.specs).toEqual([]);
		expect(hasProductInfo(info)).toBe(false);
	});

	it('delimita il numero di specifiche', () => {
		const rows = Array.from({ length: 200 }, (_, i) => `<tr><th>Voce ${i}</th><td>${i}</td></tr>`).join('');
		const info = extractProductInfo(doc(`<div class="specifications"><table>${rows}</table></div>`));
		expect(info.specs).toHaveLength(LIMITS.specs);
	});
});

describe('productInfo - utilita', () => {
	it('interpreta i numeri in formato italiano e inglese', () => {
		expect(parseNumber('4,5 su 5')).toBe(4.5);
		expect(parseNumber('1.234 valutazioni')).toBe(1234);
		expect(parseNumber('1,234 ratings')).toBe(1234);
		expect(parseNumber('n/d')).toBeNull();
	});

	it('lascia intatto il testo semplice', () => {
		expect(htmlToText('Riga uno\r\nRiga due')).toBe('Riga uno\nRiga due');
	});
});

describe('interpret - scheda prodotto', () => {
	it('porta la scheda in details e preferisce la descrizione completa al meta tag', () => {
		const head = `<meta property="og:description" content="Breve.">${ld({
			'@context': 'https://schema.org', '@type': 'Product', name: 'Lampada',
			additionalProperty: [{ name: 'Attacco', value: 'E27' }],
			offers: { '@type': 'Offer', price: '39.90', priceCurrency: 'EUR' },
		})}`;
		const body = '<div class="product-description"><p>Lampada da tavolo in ottone con diffusore in vetro soffiato a mano.</p></div>';
		const data = scrape.interpret(`<html><head>${head}</head><body>${body}</body></html>`, { url: 'https://shop.example.it/lampada' });

		expect(data.details.specs).toEqual([{ name: 'Attacco', value: 'E27' }]);
		expect(data.description).toMatch(/^Lampada da tavolo in ottone/);
		expect(data.price).toBe(39.9);
	});
});
