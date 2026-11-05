import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import scraper from '../services/scraper.js';
import seeds from '../scrape/recipe/seeds.js';
import evaluator from '../services/evaluatePrice.js';
const url='https://www.backmarket.it/it-it/p/ipad-pro-2024-m4-series';
const html=readFileSync(new URL('./fixtures/backmarket/ipad-m4-selected.html',import.meta.url),'utf8');
describe('Back Market iPad M4 public page',()=>{
 it('tries the readable HTML before starting a browser for a seeded recipe',async()=>{
  const recipe=seeds.seedFor('backmarket.it');
  expect(scraper.shouldSkipTier0({recipe,allowBrowser:true,remainingMs:45000})).toBe(false);
  const fetchHtmlImpl=vi.fn().mockResolvedValue({ok:true,html,url,durationMs:1});
  const result=await scraper.scrapeProduct(url,{recipe,fetchHtmlImpl});
  expect(fetchHtmlImpl).toHaveBeenCalledOnce();expect(result.debug.usedBrowser).toBe(false);expect(result.price).toBe(937);
  expect(result.sku).toBe('eea3599b-d315-42c4-b5f0-65a795a1f2d1');expect(result.offer.variant).toEqual({storage:'256 GB',color:'Argento'});
 });
 it('does not silently follow a new default configuration on the model page',async()=>{
  const result=await scraper.scrapeProduct(url,{allowBrowser:false,fetchHtmlImpl:async()=>({ok:true,html,url,durationMs:1})});
  const decision=evaluator.evaluatePrice({scraped:result,product:{url,current_price:899,currency:'EUR'},knownOffer:{variant:{storage:'512 GB',color:'Argento'}}});
  expect(decision.validation.accepted).toBe(false);expect(decision.validation.reasons).toContain('identita_cambiata');
 });
});
