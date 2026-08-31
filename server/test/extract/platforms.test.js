import { describe, it, expect } from 'vitest';
import documentModule from '../../scrape/document.js';
import platforms from '../../scrape/extract/platforms/index.js';

const { createDocument } = documentModule;
const { detectPlatform, extract, extractVariants, PLATFORM } = platforms;

const doc = (html) => createDocument(`<html><head></head><body>${html}</body></html>`, { url: 'https://shop.it/p' });
const pick = (candidates, field) => candidates.find((c) => c.field === field);

describe('detectPlatform', () => {
	const cases = [
		['<img src="https://cdn.shopify.com/s/x.jpg">', PLATFORM.SHOPIFY],
		['<link href="/wp-content/plugins/woocommerce/style.css">', PLATFORM.WOOCOMMERCE],
		['<script>window.prestashop = {};</script>', PLATFORM.PRESTASHOP],
		['<script type="text/x-magento-init">{}</script>', PLATFORM.MAGENTO],
		['<script>window.__BCData = {};</script>', PLATFORM.BIGCOMMERCE],
		['<form action="/on/demandware.store/Sites-x/it_IT/Cart-Add">', PLATFORM.SALESFORCE],
	];

	for (const [html, expected] of cases) {
		it(`riconosce ${expected}`, () => {
			expect(detectPlatform(doc(html)).platform).toBe(expected);
		});
	}

	it('non inventa una piattaforma su uno shop artigianale', () => {
		expect(detectPlatform(doc('<div class="prezzo">44,50 €</div>')).platform).toBeNull();
	});
});

describe('Shopify', () => {
	const productJson = {
		id: 123, title: 'Zaino 35L', price: 14900, currency: 'EUR',
		variants: [
			{ id: 1, title: 'Nero', sku: 'Z-NERO', price: 14900, available: true },
			{ id: 2, title: 'Blu', sku: 'Z-BLU', price: 15900, available: false },
		],
	};

	const page = doc(`
		<img src="https://cdn.shopify.com/s/x.jpg">
		<script type="application/json" id="ProductJson-template">${JSON.stringify(productJson)}</script>`);

	it('legge il prezzo convertendo i centesimi', () => {
		// Shopify espone i prezzi come interi in centesimi: 14900 = 149,00.
		const price = pick(extract(page), 'price');
		expect(price.value).toBe(149);
		expect(price.source).toBe('platform');
	});

	it('ha il peso piu\' alto fra le sorgenti non apprese', () => {
		expect(pick(extract(page), 'price').weight).toBe(0.93);
	});

	it('estrae tutte le varianti con prezzo e disponibilita\'', () => {
		// E' il motivo per cui l'adapter esiste: alimenta product_offers.
		const { platform, variants } = extractVariants(page);

		expect(platform).toBe(PLATFORM.SHOPIFY);
		expect(variants).toHaveLength(2);
		expect(variants[0]).toMatchObject({ sku: 'Z-NERO', price: 149, available: true });
		expect(variants[1]).toMatchObject({ sku: 'Z-BLU', price: 159, available: false });
	});

	it('legge anche da ShopifyAnalytics.meta', () => {
		const alt = doc(`
			<img src="https://cdn.shopify.com/s/x.jpg">
			<script>ShopifyAnalytics.meta = {"product":{"id":7,"title":"Borraccia","price":1990,"currency":"EUR","variants":[]}};</script>`);

		expect(pick(extract(alt), 'price').value).toBe(19.9);
		expect(pick(extract(alt), 'title').value).toBe('Borraccia');
	});
});

describe('WooCommerce', () => {
	const variations = [
		{ variation_id: 11, sku: 'T-M', display_price: 29.9, is_in_stock: true, attributes: { attribute_taglia: 'M' } },
		{ variation_id: 12, sku: 'T-L', display_price: 29.9, is_in_stock: false, attributes: { attribute_taglia: 'L' } },
	];

	const page = doc(`
		<link href="/wp-content/plugins/woocommerce/style.css">
		<form class="variations_form cart" data-product_variations='${JSON.stringify(variations)}'></form>`);

	it('legge prezzo e varianti dal form del carrello', () => {
		expect(pick(extract(page), 'price').value).toBe(29.9);

		const { variants } = extractVariants(page);
		expect(variants).toHaveLength(2);
		expect(variants[1]).toMatchObject({ sku: 'T-L', available: false });
	});

	it('il localizzatore e\' eseguibile, quindi la ricetta e\' riapplicabile', () => {
		const locator = pick(extract(page), 'price').locator;
		expect(locator.strategy).toBe('css');
		expect(page.$(locator.selector).attr(locator.attr)).toBeTruthy();
	});

	it('regge un prodotto semplice senza varianti', () => {
		const semplice = doc('<link href="/wp-content/plugins/woocommerce/x.css"><form class="cart"></form>');
		expect(extract(semplice)).toEqual([]);
	});
});

describe('PrestaShop', () => {
	it('legge prezzo e disponibilita\' da window.prestashop', () => {
		const page = doc(`<script>window.prestashop = {"product":{"id_product":5,"price_amount":89.9,"availability":"in stock"}};</script>`);
		const candidates = extract(page);

		expect(pick(candidates, 'price').value).toBe(89.9);
		expect(pick(candidates, 'availability').value).toBe('in_stock');
	});
});

describe('robustezza', () => {
	it('non produce nulla su una piattaforma senza adapter', () => {
		expect(extract(doc('<script type="text/x-magento-init">{}</script>'))).toEqual([]);
	});

	it('non esplode su JSON malformato', () => {
		const page = doc(`
			<img src="https://cdn.shopify.com/s/x.jpg">
			<script type="application/json" id="ProductJson-x">{rotto</script>`);
		expect(() => extract(page)).not.toThrow();
		expect(extract(page)).toEqual([]);
	});

	it('non esplode su una pagina vuota', () => {
		expect(extract(createDocument(''))).toEqual([]);
		expect(extractVariants(createDocument('')).variants).toEqual([]);
	});
});
