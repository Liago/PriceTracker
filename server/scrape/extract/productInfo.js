/**
 * Scheda prodotto: descrizione, caratteristiche, specifiche, valutazioni e
 * categoria.
 *
 * Non partecipa alla riconciliazione del prezzo. Gli altri estrattori
 * producono candidati che si votano a vicenda perche' un prezzo sbagliato ha
 * conseguenze (notifiche, storico); queste informazioni sono invece solo da
 * mostrare, e una lettura parziale vale piu' di nessuna. Per questo vivono in
 * un modulo a parte, che legge il Document e restituisce un oggetto piatto.
 *
 * Le fonti, dalla piu' affidabile:
 *  1. JSON-LD schema.org: additionalProperty, aggregateRating, BreadcrumbList,
 *     e i campi diretti (model, color, material, weight...)
 *  2. microdata (itemprop) con la stessa semantica
 *  3. DOM: i blocchi noti di Amazon e, in generale, tabelle e liste di
 *     definizioni dentro contenitori che si dichiarano "specifiche",
 *     "caratteristiche", "dettagli" e simili
 *
 * Tutto e' delimitato: un negozio che mette l'intero catalogo in una tabella
 * non deve gonfiare la riga del prodotto.
 */

const { load } = require('cheerio');
const { findProducts, hasType, asArray } = require('./jsonLd');

const LIMITS = Object.freeze({
	features: 20,
	featureLength: 500,
	specs: 80,
	specName: 80,
	specValue: 400,
	description: 6000,
	breadcrumbs: 8,
});

/** Spazi, caratteri di direzione e separatori decorativi di Amazon. */
function clean(value) {
	if (value === null || value === undefined) return '';
	return String(value)
		.replace(/[‎‏‪-‮⁠﻿]/g, '')
		.replace(/ /g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Nome di una specifica, senza i due punti finali. */
function cleanName(value) {
	return clean(value).replace(/\s*[:：]\s*$/, '').replace(/^[•·\-–\s]+/, '').trim();
}

/**
 * Testo di un nodo con gli a capo dei blocchi: un paragrafo resta un
 * paragrafo, una lista resta una lista.
 */
function blockText($, element) {
	const node = $(element).clone();
	node.find('script, style, noscript, iframe, button, svg').remove();
	node.find('br').replaceWith('\n');
	node.find('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article').each((_, el) => {
		const child = $(el);
		if ((el.tagName || el.name) === 'li') child.prepend('• ');
		child.append('\n');
	});
	return node.text()
		.split('\n')
		.map((line) => clean(line))
		.filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Converte una descrizione HTML (JSON-LD, Shopify) in testo. */
function htmlToText(html) {
	const raw = String(html ?? '');
	if (!/[<&]/.test(raw)) return raw.replace(/\r\n?/g, '\n').split('\n').map(clean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	const $ = load(`<div id="__root">${raw}</div>`);
	return blockText($, $('#__root'));
}

/** Un elemento sta nella navigazione o nel piede di pagina? */
function inChrome($, element) {
	return $(element).closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], #nav-main, #navFooter').length > 0;
}

/** Il nome di una specifica e' da scartare (recensioni, classifiche, garanzie legali...)? */
const NOISY_SPEC = /(recensi|review|valutazion|rating|classifica|best\s*sellers?\s*rank|bestseller|posizione nella|garanzia legale|feedback|domande|q&a|politica di reso)/i;

/** Raccoglitore delle specifiche, con deduplica sul nome. */
function createSpecs() {
	const items = [];
	const seen = new Set();
	return {
		items,
		add(name, value, group = null) {
			const n = cleanName(name);
			const v = clean(value).replace(/^[:：]\s*/, '');
			if (!n || !v || n.length > LIMITS.specName || v.length > LIMITS.specValue) return;
			if (NOISY_SPEC.test(n) || n.toLowerCase() === v.toLowerCase()) return;
			const key = n.toLowerCase();
			if (seen.has(key) || items.length >= LIMITS.specs) return;
			seen.add(key);
			items.push(group ? { group: clean(group), name: n, value: v } : { name: n, value: v });
		},
	};
}

/** Raccoglitore delle caratteristiche, con deduplica sul testo. */
function createFeatures() {
	const items = [];
	const seen = new Set();
	return {
		items,
		add(text) {
			const value = clean(text).replace(/^[•·\-–]\s*/, '');
			if (value.length < 3 || value.length > LIMITS.featureLength) return;
			const key = value.toLowerCase();
			if (seen.has(key) || items.length >= LIMITS.features) return;
			seen.add(key);
			items.push(value);
		},
	};
}

/** Numero in formato italiano o inglese: "4,5", "1.234", "1,234". */
function parseNumber(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const text = clean(value);
	const match = text.match(/\d+(?:[.,\s]\d+)*/);
	if (!match) return null;
	let raw = match[0].replace(/\s/g, '');
	// Separatore delle migliaia: gruppi da tre cifre dopo il segno.
	if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');
	else raw = raw.replace(',', '.');
	const number = Number(raw);
	return Number.isFinite(number) ? number : null;
}

function quantityText(value) {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'object') return clean(value) || null;
	const amount = value.value ?? value['@value'];
	if (amount === undefined || amount === null) return clean(value.name) || null;
	const unit = value.unitText || value.unitCode || '';
	return clean(`${amount} ${unit}`) || null;
}

function nameOf(value) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number') return clean(value) || null;
	if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ') || null;
	return clean(value.name ?? value['@value'] ?? '') || null;
}

/** Il Product della pagina, se e' uno solo o se si riconosce come principale. */
function mainProduct(doc) {
	const products = findProducts(doc.jsonLdBlocks());
	if (products.length === 0) return null;
	if (products.length === 1) return products[0].node;
	const main = products.filter((p) => /\.mainEntity(?:\.|$)/.test(p.path));
	if (main.length === 1) return main[0].node;
	// Piu' Product: quelli annidati in hasVariant sono varianti del primo.
	const roots = products.filter((p) => !p.path.includes('hasVariant'));
	return roots.length === 1 ? roots[0].node : null;
}

/** Specifiche, valutazione e categoria dal JSON-LD. */
function fromJsonLd(doc, product, specs) {
	const out = { rating: null, category: null, breadcrumbs: [], description: null };
	if (product) {
		for (const property of asArray(product.additionalProperty)) {
			if (!property || typeof property !== 'object') continue;
			const value = Array.isArray(property.value) ? property.value.join(', ') : property.value;
			const unit = property.unitText && !String(value).includes(property.unitText) ? ` ${property.unitText}` : '';
			specs.add(property.name, value === undefined || value === null ? '' : `${value}${unit}`);
		}

		const direct = [
			['Modello', nameOf(product.model)],
			['Codice produttore', nameOf(product.mpn)],
			['Colore', nameOf(product.color)],
			['Materiale', nameOf(product.material)],
			['Taglia', nameOf(product.size)],
			['Peso', quantityText(product.weight)],
			['Larghezza', quantityText(product.width)],
			['Altezza', quantityText(product.height)],
			['Profondità', quantityText(product.depth)],
			['Paese di origine', nameOf(product.countryOfOrigin)],
			['Data di uscita', nameOf(product.releaseDate)],
			['Fascia d\'età', nameOf(product.audience?.suggestedMinAge) ? `${nameOf(product.audience.suggestedMinAge)}+ anni` : null],
		];
		for (const [name, value] of direct) if (value) specs.add(name, value);

		const rating = product.aggregateRating;
		if (rating && typeof rating === 'object') {
			const value = parseNumber(rating.ratingValue);
			if (value !== null) {
				out.rating = {
					value,
					count: parseNumber(rating.reviewCount ?? rating.ratingCount),
					best: parseNumber(rating.bestRating) ?? 5,
				};
			}
		}

		const category = nameOf(product.category);
		if (category) out.category = category.split(/\s*[>/|]\s*/).filter(Boolean).pop() || category;

		if (product.description) out.description = htmlToText(product.description);
	}

	// BreadcrumbList: puo' stare ovunque, non solo dentro il Product.
	const lists = [];
	const walk = (node, depth) => {
		if (!node || typeof node !== 'object' || depth > 6) return;
		if (Array.isArray(node)) { node.forEach((child) => walk(child, depth + 1)); return; }
		if (hasType(node, 'BreadcrumbList')) lists.push(node);
		if (node['@graph']) walk(node['@graph'], depth + 1);
		if (node.breadcrumb) walk(node.breadcrumb, depth + 1);
	};
	walk(doc.jsonLdBlocks(), 0);
	const list = lists.find((l) => asArray(l.itemListElement).length > 0);
	if (list) {
		out.breadcrumbs = asArray(list.itemListElement)
			.slice()
			.sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0))
			.map((item) => nameOf(item?.name) || nameOf(item?.item))
			.filter(Boolean);
	}

	return out;
}

/** Specifiche e valutazione da microdata. */
function fromMicrodata(doc, specs) {
	const $ = doc.$;
	$('[itemprop="additionalProperty"]').each((_, element) => {
		const node = $(element);
		const name = node.find('[itemprop="name"]').first();
		const value = node.find('[itemprop="value"]').first();
		const read = (n) => n.attr('content') ?? n.text();
		if (name.length && value.length) specs.add(read(name), read(value));
	});

	const ratingNode = $('[itemprop="aggregateRating"]').first();
	if (!ratingNode.length) return null;
	const read = (prop) => {
		const n = ratingNode.find(`[itemprop="${prop}"]`).first();
		return n.length ? (n.attr('content') ?? n.text()) : null;
	};
	const value = parseNumber(read('ratingValue'));
	if (value === null) return null;
	return { value, count: parseNumber(read('reviewCount') ?? read('ratingCount')), best: parseNumber(read('bestRating')) ?? 5 };
}

/** I blocchi noti di Amazon: punti elenco, tabelle tecniche, dettagli. */
function fromAmazon(doc, specs, features) {
	const $ = doc.$;
	if (!$('#dp, #dp-container, #ppd, #centerCol, #productTitle').length) return { matched: false, rating: null, description: null, breadcrumbs: [] };

	$('#feature-bullets li, #featurebullets_feature_div li, #productFactsDesktopExpander li').each((_, el) => {
		const node = $(el);
		if (node.is('#replacementPartsFitmentBullet, .aok-hidden')) return;
		features.add(node.find('.a-list-item').first().text() || node.text());
	});

	const tables = [
		'#productOverview_feature_div tr',
		'#poExpander tr',
		'#productDetails_techSpec_section_1 tr',
		'#productDetails_techSpec_section_2 tr',
		'#technicalSpecifications_section_1 tr',
		'#productDetails_detailBullets_sections1 tr',
		'#prodDetails table tr',
		'#tech table tr',
	];
	$(tables.join(', ')).each((_, row) => {
		const cells = $(row).children('th, td');
		if (cells.length === 2) specs.add($(cells[0]).text(), $(cells[1]).text());
	});

	$('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li').each((_, el) => {
		const bold = $(el).find('.a-text-bold').first();
		if (!bold.length) return;
		const value = bold.nextAll('span').first().text() || bold.parent().text().replace(bold.text(), '');
		specs.add(bold.text(), value);
	});

	let rating = null;
	const ratingText = clean($('#acrPopover').attr('title') || $('#acrPopover .a-icon-alt').first().text()
		|| $('[data-hook="rating-out-of-text"]').first().text());
	const ratingValue = parseNumber(ratingText);
	if (ratingValue !== null && ratingValue <= 5) {
		rating = { value: ratingValue, count: parseNumber($('#acrCustomerReviewText').first().text()), best: 5 };
	}

	let description = null;
	const descriptionNode = $('#productDescription').first();
	if (descriptionNode.length) description = blockText($, descriptionNode) || null;
	if (!description) {
		const aplus = $('#aplus_feature_div, #aplus').first();
		if (aplus.length) description = blockText($, aplus) || null;
	}

	const breadcrumbs = $('#wayfinding-breadcrumbs_feature_div li a').toArray().map((a) => clean($(a).text())).filter(Boolean);

	return { matched: true, rating, description, breadcrumbs };
}

const SECTION_HINT = /(spec|tech|scheda|caratteristic|attribut|detail|dettagl|propert|feature|highlight|punti[-_ ]?chiave|key[-_ ]?point|informazioni|overview|panoramica|datasheet)/i;
const FEATURE_HINT = /(feature|highlight|caratteristic|punti[-_ ]?chiave|key[-_ ]?point|benefit|vantagg|usp|bullet)/i;
const DESCRIPTION_SELECTORS = [
	'[itemprop="description"]',
	'#product-description', '#productDescription', '#description', '#tab-description',
	'.product-description', '.product__description', '.product-single__description', '.productDescription',
	'.woocommerce-Tabs-panel--description', '.product-info__description', '.product-detail-description',
	'[data-testid*="description" i]', '[class*="ProductDescription"]', '[class*="product-description"]',
];

/** Identificatori di un nodo e dei suoi antenati vicini, per riconoscere una sezione. */
function sectionLabel($, element) {
	const parts = [];
	let node = $(element);
	for (let i = 0; i < 4 && node.length; i++) {
		parts.push(node.attr('id') || '', node.attr('class') || '', node.attr('aria-label') || '', node.attr('data-testid') || '');
		// Il titolo che precede la sezione dice spesso cosa contiene.
		const heading = node.prevAll('h1, h2, h3, h4, h5').first();
		if (heading.length) parts.push(heading.text());
		node = node.parent();
	}
	return parts.join(' ');
}

/** Tabelle a due colonne e liste di definizioni nelle sezioni pertinenti. */
function fromGenericDom(doc, specs, features) {
	const $ = doc.$;

	$('table').each((_, table) => {
		if (inChrome($, table)) return;
		const rows = $(table).find('tr').toArray().filter((row) => $(row).closest('table')[0] === table);
		if (rows.length < 2) return;
		const pairs = rows
			.map((row) => $(row).children('th, td'))
			.filter((cells) => cells.length === 2)
			.map((cells) => [$(cells[0]).text(), $(cells[1]).text()]);
		// Una tabella di specifiche e' fatta (quasi) solo di coppie nome/valore.
		if (pairs.length < 2 || pairs.length < rows.length * 0.7) return;
		const label = sectionLabel($, table);
		const header = clean($(table).find('caption').first().text()) || null;
		if (!SECTION_HINT.test(label) && !$(table).find('th').length) return;
		pairs.forEach(([name, value]) => specs.add(name, value, header));
	});

	$('dl').each((_, list) => {
		if (inChrome($, list)) return;
		if (!SECTION_HINT.test(sectionLabel($, list))) return;
		$(list).children('dt').each((__, dt) => {
			const dd = $(dt).nextAll('dd').first();
			if (dd.length) specs.add($(dt).text(), dd.text());
		});
	});

	// Righe "nome: valore" fatte di div, come nei temi moderni.
	$('[class*="spec" i] li, [class*="attribute" i] li, [class*="scheda" i] li').each((_, el) => {
		if (inChrome($, el)) return;
		const children = $(el).children();
		if (children.length === 2) specs.add($(children[0]).text(), $(children[1]).text());
	});

	$('ul').each((_, list) => {
		if (inChrome($, list) || features.items.length >= LIMITS.features) return;
		if (!FEATURE_HINT.test(sectionLabel($, list))) return;
		const items = $(list).children('li').filter((__, li) => !/(^|\s)(hidden|aok-hidden|d-none|sr-only)(\s|$)/.test($(li).attr('class') || ''));
		if (items.length < 2 || items.length > 30) return;
		// Liste di link sono menu, non caratteristiche.
		if (items.filter((__, li) => $(li).find('a').length > 0).length > items.length / 2) return;
		items.each((__, li) => features.add($(li).text()));
	});

	let description = null;
	for (const selector of DESCRIPTION_SELECTORS) {
		const node = $(selector).filter((_, el) => !inChrome($, el) && (el.tagName || el.name) !== 'meta').first();
		if (!node.length) continue;
		const text = blockText($, node);
		if (text && text.length >= 40) { description = text; break; }
	}

	const breadcrumbs = $('nav[aria-label*="breadcrumb" i] a, .breadcrumb a, .breadcrumbs a, [class*="Breadcrumb"] a, ol[itemtype*="BreadcrumbList"] [itemprop="name"]')
		.toArray().map((a) => clean($(a).text())).filter(Boolean);

	return { description, breadcrumbs };
}

/** La descrizione piu' informativa fra quelle trovate, tagliata a misura. */
function bestDescription(...values) {
	const texts = values.map((value) => (value ? String(value).trim() : '')).filter((value) => value.length > 0);
	if (texts.length === 0) return null;
	const best = texts.reduce((a, b) => (b.length > a.length ? b : a));
	return best.length > LIMITS.description ? `${best.slice(0, LIMITS.description).replace(/\s+\S*$/, '')}…` : best;
}

function cleanBreadcrumbs(items, title) {
	const out = [];
	for (const item of items) {
		const value = clean(item);
		if (!value || /^(home|homepage|torna indietro|indietro|back)$/i.test(value)) continue;
		if (title && value.toLowerCase() === clean(title).toLowerCase()) continue;
		if (out[out.length - 1] !== value) out.push(value);
	}
	return out.slice(-LIMITS.breadcrumbs);
}

/**
 * @param {import('../document').ScrapeDocument} doc
 * @param {object} [options]
 * @param {string|null} [options.title] - titolo del prodotto, per ripulire il breadcrumb
 * @returns {{description: string|null, features: string[], specs: Array<{name: string, value: string, group?: string}>,
 *   rating: {value: number, count: number|null, best: number}|null, breadcrumbs: string[], category: string|null}}
 */
function extractProductInfo(doc, options = {}) {
	const specs = createSpecs();
	const features = createFeatures();
	const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

	const product = safe(() => mainProduct(doc), null);
	const structured = safe(() => fromJsonLd(doc, product, specs), { rating: null, category: null, breadcrumbs: [], description: null });
	const microRating = safe(() => fromMicrodata(doc, specs), null);
	const amazon = safe(() => fromAmazon(doc, specs, features), { matched: false, rating: null, description: null, breadcrumbs: [] });
	// Su Amazon i blocchi noti bastano: le euristiche generiche vi troverebbero
	// tabelle comparative e caroselli di altri prodotti.
	const generic = amazon.matched ? { description: null, breadcrumbs: [] }
		: safe(() => fromGenericDom(doc, specs, features), { description: null, breadcrumbs: [] });

	const breadcrumbs = cleanBreadcrumbs(
		structured.breadcrumbs.length ? structured.breadcrumbs : amazon.breadcrumbs.length ? amazon.breadcrumbs : generic.breadcrumbs,
		options.title,
	);

	return {
		description: bestDescription(structured.description, amazon.description, generic.description),
		features: features.items,
		specs: specs.items,
		rating: structured.rating || microRating || amazon.rating,
		breadcrumbs,
		category: structured.category || breadcrumbs[breadcrumbs.length - 1] || null,
	};
}

/** Ci sono informazioni da salvare? */
function hasProductInfo(info) {
	if (!info) return false;
	return Boolean(info.description) || info.features?.length > 0 || info.specs?.length > 0
		|| Boolean(info.rating) || info.breadcrumbs?.length > 0 || Boolean(info.category);
}

module.exports = { extractProductInfo, hasProductInfo, bestDescription, htmlToText, parseNumber, LIMITS };
