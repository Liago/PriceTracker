import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import readiness from '../scrape/browserReadiness.js';
import scraper from '../services/scraper.js';
import engine from '../scrape/index.js';

const url = 'https://www.amazon.it/dp/B09K48BMV8';
const shell = body => `<html><head><title>Zeiss 200 salviette</title></head><body>
<h1 id="productTitle">Zeiss 200 salviette</h1><img id="landingImage" src="https://example.com/zeiss.jpg">
${body}<section id="productDescription">${'Salviette per la pulizia delle lenti. '.repeat(80)}</section></body></html>`;
const makeDom = html => new JSDOM(html, { url, runScripts: 'outside-only' });
const ready = dom => dom.window.eval(`(${readiness.productReady.toString()})()`);

describe('Amazon asynchronously loaded purchase box', () => {
 it('waits when availability and empty purchase containers precede the price', () => {
  const dom = makeDom(shell('<div id="availability">Disponibilità immediata</div><div id="apex_desktop"></div><div id="buybox"></div>'));
  expect(ready(dom)).toBe(false);
  dom.window.document.querySelector('#buybox').innerHTML = '<span id="price_inside_buybox">19,99 €</span>';
  expect(ready(dom)).toBe(true);
  dom.window.close();
 });
 it.each(['Attualmente non disponibile', 'Currently unavailable'])('does not wait for a price on an explicitly unavailable product: %s', text => {
  const dom = makeDom(shell(`<div id="availability">${text}</div>`));
  expect(ready(dom)).toBe(true);dom.window.close();
 });
 it('recognizes the existing cart-only response as a terminal state', () => {
  const dom = makeDom(shell('<div id="buybox">Per visualizzare il prezzo aggiungi l’articolo al carrello.</div>'));
  expect(ready(dom)).toBe(true);dom.window.close();
 });
 it('does not treat a list price or hidden template as a loaded purchase price', () => {
  const dom = makeDom(shell('<div id="corePriceDisplay_desktop_feature_div"><span class="a-price a-text-price"><span class="a-offscreen">29,99 €</span></span><div hidden><span class="a-offscreen">19,99 €</span></div></div>'));
  expect(ready(dom)).toBe(false);dom.window.close();
 });
 it.each([
  '<div id="buybox"><span id="price_inside_buybox">19,99 €</span></div>',
  '<div id="buybox"><span id="newBuyBoxPrice">19,99 €</span></div>',
  '<div id="corePrice_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">19,99 €</span></span></div>',
 ])('extracts an explicit primary-price format without unrelated prices', markup => {
  const result = engine.interpret(shell(`<div id="similarities"><span class="a-price">2 €</span></div>${markup}`), {url});
  expect(result.price).toBe(19.99);expect(result.currency).toBe('EUR');
  expect(result.confidence).toBeGreaterThanOrEqual(.85);
 });
 it('does not substitute a subscription price for a missing primary price', () => {
  const result = engine.interpret(shell('<div id="sns-offer"><span id="price_inside_buybox">17,99 €</span></div>'), {url});
  expect(result.price).toBeNull();
 });
 it('waits for the asynchronous price before capturing HTML, without inventing a retailer session', async () => {
  const dom = makeDom(shell('<div id="availability">Disponibilità immediata</div><div id="buybox"></div>'));
  const page = fakePage(dom);
  page.waitForFunction = vi.fn(async (fn, options) => {
   expect(options.timeout).toBeGreaterThan(2500);expect(options.timeout).toBeLessThanOrEqual(8000);
   expect(dom.window.eval(`(${fn.toString()})()`)).toBe(false);
   dom.window.document.querySelector('#buybox').innerHTML = '<span id="price_inside_buybox">19,99 €</span>';
   expect(dom.window.eval(`(${fn.toString()})()`)).toBe(true);
  });
  const close = vi.fn();
  const out = await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 20000, maxRetries: 0, createBrowserImpl: async () => ({newPage: async () => page, close}) });
  expect(out.price).toBe(19.99);expect(out.debug.priceReadinessTimedOut).toBe(false);
  expect(page.setCookie).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
  dom.window.close();
 });
 it('reports an unfinished price load separately from an invalid product configuration', async () => {
  const dom = makeDom(shell('<div id="availability">Disponibilità immediata</div><div id="buybox"></div>'));
  const page = fakePage(dom);
  page.waitForFunction = vi.fn(async () => {throw Object.assign(new Error('price not ready'), {name:'TimeoutError'})});
  const out = await scraper.scrapeProduct(url, { allowHttp: false, budgetMs: 20000, maxRetries: 0, createBrowserImpl: async () => ({newPage: async () => page, close: async () => {}}) });
  expect(out.price).toBeNull();expect(out.debug.priceReadinessTimedOut).toBe(true);
  expect(out.debug.degraded).toBe('prezzo_non_caricato');dom.window.close();
 });
});

function fakePage(dom) {
 return {
  setViewport: async () => {}, setUserAgent: async () => {}, setExtraHTTPHeaders: async () => {},
  setRequestInterception: async () => {}, on: () => {}, goto: async () => {},
  setCookie: vi.fn(async () => {throw new Error('Do not invent session cookies')}),
  title: async () => dom.window.document.title, url: () => url,
  evaluate: async (fn, arg) => dom.window.eval(`(${fn.toString()})`)(arg),
  content: async () => dom.serialize(),
 };
}
