import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import engine from '../scrape/index.js';
import evaluator from '../services/evaluatePrice.js';
import offer from '../scrape/normalize/offer.js';
import scraper from '../services/scraper.js';
const html=readFileSync(new URL('./fixtures/amazon/ariete-price-requires-cart.html',import.meta.url),'utf8');
const url='https://www.amazon.it/dp/B0DSQ4RZ1B';
describe('Ariete 3919 real Amazon markup',()=>{
 it('recognizes a withheld main price and never substitutes the 44 EUR other-seller minimum',()=>{
  const out=engine.interpret(html,{url});expect(out.price).toBeNull();expect(out.priceStatus).toBe('price_requires_cart');expect(out.sku).toBe('B0DSQ4RZ1B');
  const decision=evaluator.evaluatePrice({scraped:out,product:{url,current_price:34.16,currency:'EUR'}});expect(decision.validation.accepted).toBe(false);expect(decision.validation.reasons).toContain('price_requires_cart');
 });
 it('prefers a valid main price over a fallback cart notice elsewhere in the buy box',()=>{
  const out=engine.interpret(html.replace('</body>','<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">39,90 €</span></span></div></body>'),{url});
  expect(out.price).toBe(39.90);expect(out.priceStatus).toBeNull();
 });
 it('returns a genuine cart-only reading without launching a browser or calling it a timeout',async()=>{
  const out=await scraper.scrapeProduct(url,{budgetMs:1500,fetchHtmlImpl:async()=>({ok:true,html,url,durationMs:1})});
  expect(out.priceStatus).toBe('price_requires_cart');expect(out.debug.usedBrowser).toBe(false);expect(out.debug.degraded).toBeNull();
 });
 it('normalizes Amazon tracking paths while preserving explicit merchant selection',()=>{
  const out=offer.canonicalizeUrl('https://www.amazon.it/Ariete-3919/dp/B0DSQ4RZ1B/ref=pd_ci?pd_rd_w=tracking&th=1&smid=merchant');
  expect(out).toBe(url+'?smid=merchant');
 });
 it('keeps the final Amazon identity when a product was supplied through a short URL',()=>{
  const out=evaluator.descriptorOf({sku:'B0DSQ4RZ1B',offer:{url}},'https://amzn.eu/d/0gJXM5tU');expect(out.url).toBe(url);expect(out.sku).toBe('B0DSQ4RZ1B');
 });
});
