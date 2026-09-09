import { describe, it, expect } from 'vitest';
import seeds from '../../scrape/recipe/seeds.js';
import { runPipeline } from '../../scrape/pipeline.js';
import { createDocument } from '../../scrape/document.js';

const { AMAZON_FIELDS, seedFor } = seeds;

/**
 * Una pagina Amazon ridotta all'osso ma con la trappola vera: il prezzo di uno
 * sponsorizzato compare nel DOM PRIMA di quello del prodotto.
 */
const amazonPage = ({ mainPrice = '379,99 €', sponsoredPrice = '109,83 €', availability = 'Disponibilità immediata' } = {}) => `
<html><head>
  <title>SIHOO Doro S100 Sedia Ergonomica</title>
  <meta property="og:image" content="https://m.media-amazon.com/images/I/71BXp4eBcmL.jpg">
</head><body>
  <div id="sponsoredProducts">
    <div class="a-price"><span class="a-offscreen">${sponsoredPrice}</span></div>
  </div>
  <div id="centerCol">
    <h1 id="productTitle">SIHOO Doro S100 Sedia Ergonomica Ufficio, Supporto Lombare Dinamico, Nero</h1>
    <div id="corePriceDisplay_desktop_feature_div">
      <div class="a-price"><span class="a-offscreen">${mainPrice}</span></div>
    </div>
    <img id="landingImage" src="https://m.media-amazon.com/images/I/71BXp4eBcmL.jpg">
    <div id="availability"><span>${availability}</span></div>
  </div>
  <div id="similarities">
    <div class="a-price"><span class="a-offscreen">49,90 €</span></div>
  </div>
</body></html>`;

describe('la ricetta Amazon non deve poter leggere il prezzo di un altro prodotto', () => {
	it('nessun selettore di prezzo e’ globale', () => {
		// `.a-price .a-offscreen` senza ambito prende il primo prezzo della
		// pagina, che su Amazon e' spesso uno sponsorizzato. E' cio' che ha
		// registrato una sedia da 379,99 come 109,83.
		const selectors = [AMAZON_FIELDS.price, ...AMAZON_FIELDS.price.fallbacks]
			.filter((spec) => spec.strategy === 'css')
			.map((spec) => spec.selector);

		expect(selectors.length).toBeGreaterThan(0);
		for (const selector of selectors) {
			expect(selector.startsWith('#')).toBe(true);
		}
		expect(selectors).not.toContain('.a-price .a-offscreen');
		expect(selectors).not.toContain('.apexPriceToPay .a-offscreen');
	});

	it('legge il prezzo del prodotto, non quello dello sponsorizzato che lo precede', () => {
		const doc = createDocument(amazonPage(), { url: 'https://www.amazon.it/dp/B0CTSDG3VD' });
		const result = runPipeline(doc, { recipe: { ...seedFor('amazon.it'), success_count: 20 } });

		expect(result.result.price).toBe(379.99);
	});

	it('la ricetta legge la disponibilita’, che prima mancava del tutto', () => {
		expect(AMAZON_FIELDS.availability).toBeDefined();

		const doc = createDocument(amazonPage(), { url: 'https://www.amazon.it/dp/B0CTSDG3VD' });
		const result = runPipeline(doc, { recipe: { ...seedFor('amazon.it'), success_count: 20 } });

		expect(result.result.availability).toBe('in_stock');
	});

	it('riconosce anche un prodotto esaurito', () => {
		const doc = createDocument(amazonPage({ availability: 'Attualmente non disponibile' }), {
			url: 'https://www.amazon.it/dp/B0CTSDG3VD',
		});
		const result = runPipeline(doc, { recipe: { ...seedFor('amazon.it'), success_count: 20 } });

		expect(result.result.availability).toBe('out_of_stock');
	});
});

describe('il fast path non si fida di un prezzo arrivato per fallback', () => {
	/** Ricetta la cui strategia principale non trova nulla su questa pagina. */
	const recipeWithBrokenPrimary = {
		domain: 'shop.it',
		success_count: 50, // collaudata: il peso, e quindi la confidenza, e' alto
		fields: {
			price: {
				strategy: 'css', selector: '#prezzo-che-non-esiste-piu', attr: null,
				fallbacks: [{ strategy: 'css', selector: '#centerCol .a-price .a-offscreen', attr: null }],
			},
		},
	};

	it('quando risponde il fallback si esegue comunque la scoperta', () => {
		const doc = createDocument(amazonPage(), { url: 'https://www.amazon.it/dp/X' });
		const result = runPipeline(doc, { recipe: recipeWithBrokenPrimary });

		// Il punto: la confidenza del fast path misura l'accordo fra sorgenti,
		// ma il fast path le altre sorgenti non le esegue. Un fallback che entra
		// in gioco significa che la pagina e' cambiata, ed e' il momento peggiore
		// per fermarsi al primo numero trovato.
		expect(result.usedFastPath).toBe(false);
		expect(result.extractorsRan.map((e) => e.name)).toContain('jsonld');
	});

	it('mentre la strategia principale conserva il fast path', () => {
		const working = {
			domain: 'amazon.it',
			success_count: 50,
			fields: {
				price: { strategy: 'css', selector: '#corePriceDisplay_desktop_feature_div .a-offscreen', attr: null },
				title: { strategy: 'css', selector: '#productTitle', attr: null },
				image: { strategy: 'meta', key: 'og:image' },
			},
		};
		const doc = createDocument(amazonPage(), { url: 'https://www.amazon.it/dp/X' });
		const result = runPipeline(doc, { recipe: working });

		expect(result.usedFastPath).toBe(true);
		expect(result.result.price).toBe(379.99);
	});
});
