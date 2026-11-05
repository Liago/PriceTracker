import {describe,it,expect,vi} from 'vitest';
import worker from '../../../netlify/functions/worker.js';
const product={id:'p1',user_id:'u1',name:'Phone',url:'https://shop.example/phone',domain:'shop.example',current_price:729,currency:'EUR',target_price:700,last_checked_at:'2026-01-01T00:00:00Z'};
function fakeClient({limited=false,commitError=false,claimError=false}={}){
 const writes=[],rpc=vi.fn(async(name,args)=>{
  if(name==='claim_scrape_jobs') return claimError?{error:{message:'database down'}}:{data:[{id:'j1',product_id:'p1',domain:'shop.example',url:product.url,attempts:3,max_attempts:3}]};
  if(name==='reserve_scrape_domain') return {data:{allowed:!limited,waitMs:2500}};
  if(name==='apply_price_check') return commitError?{error:{message:'write denied'}}:{data:{priceChanged:true,notified:false}};
  return {data:{}};
 });
 const client={rpc,from:table=>{
  const chain={select:()=>chain,eq:()=>chain,not:()=>chain,order:()=>chain,limit:()=>chain,
   update:patch=>{writes.push({table,patch});return chain},
   maybeSingle:async()=>({data:table==='products'?product:table==='user_settings'?{max_retries:0}:null,error:null}),
   then:resolve=>resolve({data:[],count:0,error:null})};return chain;
 }};
 return {client,writes,rpc};
}
describe('scheduled worker integration',()=>{
 it('returns a rate-limited reservation without consuming an attempt or scraping',async()=>{
  const db=fakeClient({limited:true}),scrape=vi.fn();const handler=worker.createWorker({createClientImpl:()=>db.client,scrapeImpl:scrape,checkUrlImpl:async()=>({allowed:true})});
  expect((await handler()).statusCode).toBe(200);expect(scrape).not.toHaveBeenCalled();expect(db.writes[0].patch).toMatchObject({status:'pending',attempts:2});
 });
 it('records a blocked site on the product instead of losing the failure in the queue',async()=>{
  const db=fakeClient(),scrape=vi.fn();await worker.createWorker({createClientImpl:()=>db.client,scrapeImpl:scrape,checkUrlImpl:async()=>({allowed:false,reason:'dominio_bloccato'})})();
  expect(scrape).not.toHaveBeenCalled();const saved=db.rpc.mock.calls.find(([name])=>name==='apply_price_check')[1];expect(saved.p_patch.tracking_health).toBe('blocked');expect(saved.p_observation.accepted).toBe(false);
 });
 it('does not mark a job done if the transaction fails',async()=>{
  const db=fakeClient({commitError:true});await worker.createWorker({createClientImpl:()=>db.client,checkUrlImpl:async()=>({allowed:true}),scrapeImpl:async()=>({price:699,currency:'EUR',confidence:.95,availability:'in_stock'})})();
  expect(db.writes.some(x=>x.patch.status==='done')).toBe(false);expect(db.writes.some(x=>x.patch.last_error?.includes('write denied'))).toBe(true);
 });
 it('a claim error is a failed invocation, not a successful empty queue',async()=>{
  const db=fakeClient({claimError:true});expect((await worker.createWorker({createClientImpl:()=>db.client})()).statusCode).toBe(500);
 });
});
