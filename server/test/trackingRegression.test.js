import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import engine from '../scrape/index.js';
import seeds from '../scrape/recipe/seeds.js';
import evaluator from '../services/evaluatePrice.js';
import checker from '../services/productChecker.js';
import repository from '../services/trackingRepository.js';
import queueModule from '../scrape/jobs/queue.js';
const {interpret}=engine, {evaluatePrice,cents}=evaluator;
const fixture=(name)=>readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8');
const page=body=>`<html><head><meta property="og:title" content="Phone"><meta property="og:image" content="https://example.com/p.jpg"></head><body>${body}</body></html>`;
const ld=price=>`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Phone',image:'https://example.com/p.jpg',offers:{'@type':'Offer',price,priceCurrency:'EUR'}})}</script>`;
const product={id:'p1',url:'https://shop.example/phone',current_price:729,currency:'EUR',target_price:700};
const reading=(price,source='jsonld',extra={})=>({price,priceValue:price,currency:'EUR',availability:'in_stock',confidence:.88,fields:{price:{source}},...extra});
describe('Amazon and Swappie regression cases',()=>{
 it('never uses the related SONGMICS price when the SIHOO price is withheld',()=>{
  for(const recipe of [null,{...seeds.seedFor('amazon.it'),success_count:50}]){
   const out=interpret(fixture('amazon/main-price-withheld'),{url:'https://www.amazon.it/dp/B0CTSDG3VD',recipe});
   expect(out.price).toBeNull();expect(out.priceStatus).toBe('main_price_unavailable');
   expect(evaluatePrice({scraped:out,product:{url:'https://www.amazon.it/dp/B0CTSDG3VD'}}).validation.accepted).toBe(false);
  }
 });
 it('skips a struck-through Amazon list price',()=>{
  const out=interpret(page('<h1 id="productTitle">Chair</h1><div id="corePriceDisplay_desktop_feature_div"><del class="a-price"><span class="a-offscreen">499,99 €</span></del><span class="a-price"><span class="a-offscreen">379,99 €</span></span></div>'),{url:'https://amazon.it/dp/B000000001',recipe:{...seeds.seedFor('amazon.it'),success_count:50}});
  expect(out.price).toBe(379.99);
 });
 it('refuses conflicting prices inside the main buy box',()=>{
  const out=interpret(page('<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">199 €</span></span><span class="a-price"><span class="a-offscreen">299 €</span></span></div>'),{url:'https://amazon.it/dp/B000000001'});
  expect(out.price).toBeNull();
 });
 it.each([['selected-128gb',249,'128','D','in_stock'],['selected-256gb-out-of-stock',355,'256','C','out_of_stock']])('reads Swappie %s selected configuration and minor-unit precision',(name,price,storage,grade,availability)=>{
  const out=interpret(fixture('swappie/'+name),{url:'https://swappie.com/it/iphone/iphone-13/'});
  expect(out.price).toBe(price);expect(out.offer.variant).toMatchObject({storage,grade,batteryType:'Standard'});expect(out.sku).toBeTruthy();expect(out.availability).toBe(availability);expect(out.confidence).toBeGreaterThanOrEqual(.85);
 });
 it('rejects Swappie model-wide meta prices without selected configuration',()=>{
  const out=interpret(page('<meta property="product:price:amount" content="199">'),{url:'https://swappie.com/it/modello/iphone-13/'});expect(out.price).toBeNull();
 });
 it('does not give a mature meta recipe priority over fresh JSON-LD',()=>{
  const recipe={domain:'shop.example',success_count:50,fields:{price:{strategy:'meta',key:'product:price:amount'}}};
  const out=interpret(page('<meta property="product:price:amount" content="199">'+ld(249)),{url:product.url,recipe});
  expect(out.price).toBe(249);expect(out.usedFastPath).toBe(false);
 });
 it('counts a meta tag only once, even if reapplied by a recipe',()=>{
  const out=interpret(page('<meta property="product:price:amount" content="199">'),{url:product.url,recipe:{success_count:50,fields:{price:{strategy:'meta',key:'product:price:amount'}}}});
  expect(out.fields.price.agreeingSources).toEqual(['meta']);expect(out.confidence).toBeLessThan(.85);
 });
 it('selects the JSON-LD product whose URL matches the requested product',()=>{
  const products=[{ '@type':'Product',name:'Related',image:'x',url:'https://shop.example/related',offers:{price:99} },{ '@type':'Product',name:'Phone',image:'x',url:product.url,offers:{price:499} }];
  expect(interpret(page(`<script type="application/ld+json">${JSON.stringify(products)}</script>`),{url:product.url}).price).toBe(499);
 });
 it('does not accept an aggregate minimum as an exact variant price',()=>{
  const out=interpret(page(`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Phone',image:'x',offers:{'@type':'AggregateOffer',lowPrice:249,highPrice:399}})}</script>`),{url:product.url+'?storage=256'});
  expect(evaluatePrice({scraped:out,product}).validation.accepted).toBe(false);
 });
});
describe('tracking decisions',()=>{
 it('normalizes numeric strings and one-cent changes',()=>{expect(cents('729.00')).toBe(72900);expect(cents(729)-cents(728.99)).toBe(1)});
 it('rejects a different Swappie configuration or missing pinned identity',()=>{
  const scraped=reading(249,'platform',{sku:'other',offer:{variant:{storage:'128'}}});
  const out=evaluatePrice({scraped,product:{...product,sku:'selected'},knownOffer:{variant:{storage:'256'}}});expect(out.validation.reasons).toContain('identita_cambiata');
 });
 it('preserves the last trusted availability when scrape fails',async()=>{
  const commitCheck=vi.fn().mockResolvedValue({});
  await checker.checkProduct({product,scrape:async()=>{throw new Error('timeout')},repo:{getReference:async()=>({history:[],offer:null}),commitCheck}});
  expect(commitCheck.mock.calls[0][0].patch).not.toHaveProperty('availability');
 });
 it('confirms a large drop only with a matching independent source',async()=>{
  const scrape=vi.fn().mockResolvedValueOnce(reading(199,'meta')).mockResolvedValueOnce(reading(199,'jsonld'));
  const commitCheck=vi.fn().mockResolvedValue({});
  const out=await checker.checkProduct({product,scrape,repo:{getReference:async()=>({history:[{price:729}],offer:null}),commitCheck}});
  expect(scrape).toHaveBeenCalledTimes(2);expect(out.accepted).toBe(true);
 });
 it('does not confirm a changed value or the same unverified source',async()=>{
  const scrape=vi.fn().mockResolvedValue(reading(199,'dom'));
  const out=await checker.checkProduct({product,scrape,repo:{getReference:async()=>({history:[{price:729}],offer:null}),commitCheck:async()=>({})}});
  expect(out.accepted).toBe(false);
 });
 it('propagates a failed transactional write',async()=>{
  const repo=repository.createTrackingRepository({rpc:async()=>({error:{message:'disk error'}})});
  await expect(repo.commitCheck({product,descriptor:{},observation:{},patch:{},run:{}})).rejects.toThrow('disk error');
 });
 it('defers without exhausting claims that never attempted a page read',async()=>{
  let patch;const queue=queueModule.createJobQueue({client:{from:()=>({update:p=>{patch=p;return{eq:async()=>({error:null})}}})}});
  await queue.defer({id:'job',attempts:3,max_attempts:3},'rate limited',2500);expect(patch.status).toBe('pending');expect(patch.attempts).toBe(2);
 });
});
