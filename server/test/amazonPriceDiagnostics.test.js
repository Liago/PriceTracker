import { describe, it, expect } from 'vitest';
import engine from '../scrape/index.js';
import scraper from '../services/scraper.js';
import { readFileSync } from 'node:fs';

const url = 'https://www.amazon.it/dp/B09K48BMV8';
// Synthetic cases: the failing production HTML has not been captured.
const page = body => `<html><head><title>Zeiss wipes</title></head><body>
<h1 id="productTitle">Zeiss 200 salviette</h1><img id="landingImage" src="https://example.com/wipes.jpg">
<div id="availability">Disponibilità immediata</div>${body}</body></html>`;
const price = text => `<span class="a-price"><span class="a-offscreen">${text}</span></span>`;

describe('Amazon price extraction diagnostics', () => {
 it('distinguishes unsupported markup from a rejected candidate without using another seller price', () => {
  const out = engine.interpret(page(`<div id="buybox">${price('19,99 €')}</div>`), { url });
  expect(out.price).toBeNull();
  expect(out.priceDiagnostics.status).toBe('no_matching_selector');
  expect(out.priceDiagnostics.roots['#buybox']).toBe(1);
  expect(out.priceDiagnostics.priceNodes[0]).toMatchObject({ text: '19,99 €', offscreenCount: 1 });
 });
 it('reports which filters rejected the main-price nodes', () => {
  const out = engine.interpret(page(`<div id="corePriceDisplay_desktop_feature_div" style="display:none">${price('19,99 €')}</div>`), { url });
  expect(out.price).toBeNull();
  expect(out.priceDiagnostics.status).toBe('all_candidates_rejected');
  expect(out.priceDiagnostics.attempts.find(a => a.matched)).toMatchObject({ matched: 1, accepted: 0, rejected: { hidden: 1 } });
 });
 it('distinguishes ambiguous main prices from missing selectors', () => {
  const out = engine.interpret(page(`<div id="corePriceDisplay_desktop_feature_div">${price('19,99 €')}${price('29,99 €')}</div>`), { url });
  expect(out.price).toBeNull();
  expect(out.priceDiagnostics.status).toBe('ambiguous_price');
  expect(out.priceDiagnostics.attempts.at(-1).values).toEqual([19.99, 29.99]);
 });
 it('bounds evidence and excludes scripts and unrelated page content', () => {
  const body = `<div id="buybox">${Array.from({length: 20}, () => `<span class="a-price">${'9'.repeat(200)} €<script>SECRET_SESSION</script></span>`).join('')}</div><div id="reviews">PRIVATE_REVIEW</div>`;
  const { priceDiagnostics } = engine.interpret(page(body), { url });
  expect(priceDiagnostics.priceNodes).toHaveLength(12);
  expect(priceDiagnostics.priceNodes.every(n => n.text.length <= 100 && n.ancestors.length <= 8)).toBe(true);
  expect(JSON.stringify(priceDiagnostics)).not.toMatch(/SECRET_SESSION|PRIVATE_REVIEW/);
 });
 it('does not attach failure diagnostics to a valid main price', () => {
  const out = engine.interpret(page(`<div id="corePriceDisplay_desktop_feature_div">${price('19,99 €')}</div>`), { url });
  expect(out.price).toBe(19.99);
  expect(out.priceDiagnostics).toBeNull();
 });
 it('preserves extraction evidence in scraper diagnostics', async () => {
  const html = readFileSync(new URL('./fixtures/amazon/ariete-price-requires-cart.html', import.meta.url), 'utf8');
  const sourceUrl = 'https://www.amazon.it/dp/B0DSQ4RZ1B';
  const out = await scraper.scrapeProduct(sourceUrl, { budgetMs: 1500, fetchHtmlImpl: async () => ({ ok: true, html, url: sourceUrl, durationMs: 1 }) });
  expect(out.debug.priceExtraction).toEqual(out.priceDiagnostics);
  expect(out.debug.priceExtraction.status).toBe('no_matching_selector');
 });
});
