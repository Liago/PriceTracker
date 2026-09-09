import { describe, it, expect } from 'vitest';
import priceModule from '../../scrape/normalize/price.js';
import { runPipeline } from '../../scrape/pipeline.js';
import { createDocument } from '../../scrape/document.js';

const { parsePriceDetailed, hasBrokenGrouping } = priceModule;

/**
 * Il markup con cui Amazon scrive i prezzi: la versione leggibile in
 * `.a-offscreen`, e accanto la resa visiva a pezzi dentro un aria-hidden.
 */
const amazonPrice = ({ whole = '149', fraction = '99', decimal = '' } = {}) => `
  <div class="a-price">
    <span class="a-offscreen">${whole},${fraction} €</span>
    <span aria-hidden="true">
      <span class="a-price-symbol">€</span>
      <span class="a-price-whole">${whole}${decimal}</span>
      <span class="a-price-fraction">${fraction}</span>
    </span>
  </div>`;

const productPage = (priceMarkup) => `<html><head>
  <title>Scrivania regolabile</title>
  <meta property="og:image" content="https://m.media-amazon.com/images/I/61LDuVAPqkL.jpg">
</head><body><div id="centerCol">
  <h1 id="productTitle">Scrivania regolabile in altezza, elettrica 120 x 60 cm</h1>
  ${priceMarkup}
</div></body></html>`;

describe('hasBrokenGrouping - lo spazio fra cifre raggruppa per tre, o non è un numero', () => {
	it('accetta i raggruppamenti veri, in ogni convenzione', () => {
		for (const valido of ['1 234,56', '1 234 567', '2 500', '1 234']) {
			expect(hasBrokenGrouping(valido), valido).toBe(false);
		}
	});

	it('rifiuta ciò che nessun locale scrive così', () => {
		// "89 99" non è un numero in nessuna convenzione: un separatore delle
		// migliaia raggruppa sempre per tre.
		for (const rotto of ['89 99', '89\n99', '12 34', '1 2 3']) {
			expect(hasBrokenGrouping(rotto), rotto).toBe(true);
		}
	});

	it('non ha nulla da dire su un numero senza spazi', () => {
		for (const semplice of ['149,99', '8999', '€89,99']) {
			expect(hasBrokenGrouping(semplice), semplice).toBe(false);
		}
	});
});

describe('parsePrice non deve fabbricare numeri che nella pagina non c’erano', () => {
	it('due nodi finiti attaccati non sono un prezzo', () => {
		// È il caso di produzione: da 89,99 usciva 8999, con reason "ok".
		const result = parsePriceDetailed('89\n99');

		expect(result.value).toBeNull();
		expect(result.reason).toBe('cifre_concatenate');
	});

	it('ma un separatore delle migliaia resta un separatore delle migliaia', () => {
		expect(parsePriceDetailed('1 234,56').value).toBe(1234.56);
		expect(parsePriceDetailed('2 500 €').value).toBe(2500);
	});
});

describe('gli estrattori DOM ignorano i sottoalberi aria-hidden', () => {
	it('legge il prezzo leggibile, non la sua resa visiva a pezzi', () => {
		const doc = createDocument(productPage(amazonPrice()), { url: 'https://www.amazon.it/dp/B0FF9MFWVG' });
		const result = runPipeline(doc, {});

		expect(result.result.price).toBe(149.99);
	});

	it('nessun candidato porta il numero fabbricato', () => {
		// Senza a-price-decimal i nodi si attaccano senza separatore: "14999".
		// Cento volte il prezzo vero, e plausibile per chiunque lo guardi dopo.
		const doc = createDocument(productPage(amazonPrice()), { url: 'https://www.amazon.it/dp/B0FF9MFWVG' });
		const result = runPipeline(doc, {});

		const prezzi = result.candidates.filter((c) => c.field === 'price').map((c) => c.value);
		expect(prezzi).not.toContain(14999);
		expect(prezzi.every((p) => p === 149.99)).toBe(true);
	});

	it('vale anche quando il separatore decimale è nel markup', () => {
		const markup = amazonPrice({ decimal: '<span class="a-price-decimal">,</span>' });
		const doc = createDocument(productPage(markup), { url: 'https://www.amazon.it/dp/B0FF9MFWVG' });

		expect(runPipeline(doc, {}).result.price).toBe(149.99);
	});

	it('un prezzo che NON è sotto aria-hidden si legge ancora', () => {
		// La regola non deve rendere cieco l'estrattore sulle pagine normali.
		const doc = createDocument(productPage('<div class="prezzo">89,90 €</div>'), { url: 'https://shop.it/p' });

		expect(runPipeline(doc, {}).result.price).toBe(89.90);
	});
});
