import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import jobs from '../services/productImports.js';
import dispatch from '../services/importDispatch.js';
import routes from '../api/routes.js';
import {waitForImport} from '../../client/src/lib/importPolling.ts';

const url='https://www.amazon.it/dp/B09K48BMV8';
const env={NETLIFY:'true',URL:'https://app.example',SUPABASE_SERVICE_ROLE_KEY:'test-only-key'};
describe('asynchronous product additions',()=>{
 it('only enqueues on the HTTP request and never waits for a browser',async()=>{
  const post={},get={},scrape=vi.fn(),start=vi.fn(async()=>{}),rpc=vi.fn(async()=>({data:{id:'job',status:'pending'}}));
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc};
  routes.registerRoutes({getClient:()=>client,scrapeImpl:scrape,dispatchImport:start})({use(){},post:(path,fn)=>post[path]=fn,get:(path,fn)=>get[path]=fn});
  const res=response();
  await post['/products']({headers:{authorization:'Bearer token'},body:{url,requestId:randomUUID()}},res);
  expect(res.code).toBe(202);expect(res.body).toEqual({jobId:'job',status:'pending'});expect(start).toHaveBeenCalledWith('job');expect(scrape).not.toHaveBeenCalled();
 });
 it('returns the durable job even if immediate background dispatch fails',async()=>{
  const post={},client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc:async()=>({data:{id:'job',status:'pending'}})};
  routes.registerRoutes({getClient:()=>client,dispatchImport:async()=>{throw Error('timeout')}})({use(){},post:(p,f)=>post[p]=f,get(){}});
  const res=response();await post['/products']({headers:{authorization:'Bearer token'},body:{url,async:true}},res);expect(res.code).toBe(202);
 });
 it('never exposes another user’s import status',async()=>{
  const get={},eq=vi.fn(),chain={select(){return this},eq(...args){eq(...args);return this},maybeSingle:async()=>({data:null})};
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>chain};
  routes.registerRoutes({getClient:()=>client})({use(){},post(){},get:(p,f)=>get[p]=f});
  const res=response();await get['/product-imports/:id']({headers:{authorization:'Bearer token'},params:{id:'other-job'}},res);
  expect(eq).toHaveBeenCalledWith('user_id','owner');expect(res.code).toBe(404);
 });
 it('validates input before enqueuing',async()=>{
  const rpc=vi.fn();await expect(jobs.enqueueImport({rpc},'owner',{url:'file:///etc/passwd'})).rejects.toMatchObject({status:400});expect(rpc).not.toHaveBeenCalled();
 });
 it('keeps exact extraction failure diagnostics in the completed failed job',async()=>{
  let patch;
  const chain={select(){return this},eq(){return this},then(resolve){return Promise.resolve(resolve({data:[],error:null}))},update(value){patch=value;return this}};
  const client={rpc:vi.fn(async name=>({data:name==='claim_product_import'?{id:'job',lease_id:'lease',user_id:'owner',request:{url}}:null})),from:()=>chain};
  await jobs.processImport(client,'job',{checkUrlImpl:async()=>({allowed:true,url}),scrapeImpl:async()=>({price:null,priceStatus:'main_price_unavailable',confidence:0,debug:{priceExtraction:{status:'no_matching_selector'}}})});
  expect(patch.status).toBe('failed');expect(patch.error.status).toBe(422);expect(patch.error.diagnostics.priceExtraction.status).toBe('no_matching_selector');
  expect(client.rpc.mock.calls.map(c=>c[0])).not.toContain('finish_product_import');
 });
 it('polls past pending/running and returns the actual result',async()=>{
  const read=vi.fn().mockResolvedValueOnce({status:'pending'}).mockResolvedValueOnce({status:'running'}).mockResolvedValueOnce({status:'done',result:{product:{id:'product'}}});
  const delay=vi.fn(async()=>{});expect((await waitForImport('job',read,{delay})).result.product.id).toBe('product');expect(delay).toHaveBeenCalledTimes(2);
 });
 it('preserves a failed job’s diagnostics and bounds client waiting',async()=>{
  const error={status:422,code:'LOW_CONFIDENCE',diagnostics:{priceExtraction:{status:'no_matching_selector'}}};
  expect((await waitForImport('job',async()=>({id:'job',status:'failed',error}))).error).toBe(error);
  await expect(waitForImport('job',async()=>({id:'job',status:'running'}),{delay:async()=>{},maxPolls:2})).rejects.toThrow('continua in background');
 });
 it('signs only the trusted deployment invocation and rejects modified or expired payloads',async()=>{
  const request=vi.fn(async()=>({status:202}));await dispatch.dispatchImport('job',{env,request});
  const [target,options]=request.mock.calls[0];expect(target.href).toBe('https://app.example/.netlify/functions/product-import-background');
  expect(options.headers['X-Import-Signature']).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
  expect(dispatch.verifyInvocation(options.body,options.headers['X-Import-Signature'],env).id).toBe('job');
  expect(dispatch.verifyInvocation(options.body+' ',options.headers['X-Import-Signature'],env)).toBeNull();
  const stale=JSON.stringify({id:'job',at:Date.now()-120000});expect(dispatch.verifyInvocation(stale,dispatch.signature(stale,env),env)).toBeNull();
 });
});
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}}
