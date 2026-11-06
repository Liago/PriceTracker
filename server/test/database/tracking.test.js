import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import imports from '../../services/productImports.js';
let db;
const uid = '00000000-0000-0000-0000-000000000001';
const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const count = async table => Number((await one(`select count(*) n from ${table}`)).n);
beforeAll(async () => {
 db = new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function auth.role() returns text language sql as $$select 'service_role'::text$$;");
 const directory=fileURLToPath(new URL('../../database/migrations/',import.meta.url));
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync(directory+file,'utf8'));
},30000);
afterAll(async()=>{await db?.close()});
beforeEach(async()=>{
 await db.exec('truncate public.products,public.scrape_recipes,public.scrape_runs,public.notifications,public.notification_outbox,public.price_observations,public.product_offers,public.price_history,public.scrape_jobs,public.user_settings,auth.users cascade');
 await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'test@example.com']);
});
async function create(price=729, extra={}) {
 const product={user_id:uid,url:'https://shop.example/phone',domain:'shop.example',name:'Phone',current_price:price,currency:'EUR',target_price:700,availability:'in_stock',...extra};
 const descriptor={offerKey:'default',variant:{},url:product.url};
 return (await one('select public.create_tracked_product($1,$2,$3) p',[product,descriptor,{confidence:.9}])).p;
}
async function check(product, price=699, extra={}) {
 const observation={id:randomUUID(),price,currency:'EUR',availability:'in_stock',confidence:.9,accepted:true,observed_at:new Date(Date.now()+1000).toISOString(),...extra};
 return (await one('select public.apply_price_check($1,$2,$3,$4,$5,$6) result',[product.id,product.last_checked_at,{offerKey:'default',variant:{}},observation,
 {tracking_health:observation.accepted?'healthy':'degraded',consecutive_failures:observation.accepted?0:1},
 {domain:'shop.example',status:observation.accepted?'success':'quarantined',duration_ms:10,confidence:.9}])).result;
}
describe('tracking transactions on PostgreSQL',()=>{
 it('keeps import infrastructure restricted to the service role and the migration repeatable',async()=>{
  await db.exec(readFileSync(new URL('../../database/migrations/013_product_import_jobs.sql',import.meta.url),'utf8'));
  const privileges=await one("select has_function_privilege('authenticated','public.claim_product_import(uuid)','execute') auth,has_function_privilege('anon','public.finish_product_import(uuid,uuid,jsonb,jsonb,jsonb)','execute') anon,has_function_privilege('service_role','public.enqueue_product_import(uuid,uuid,jsonb)','execute') service");
  expect(privileges).toEqual({auth:false,anon:false,service:true});
  expect((await one('select tracking_schema_version() version')).version).toBe(13);
 });
 it('runs a queued addition through shared validation into its atomic final result',async()=>{
  const id=randomUUID();await one('select public.enqueue_product_import($1,$2,$3)',[id,uid,{url:'https://shop.example/phone'}]);
  const chain={select(){return this},eq(){return this},then(resolve){return Promise.resolve(resolve({data:[],error:null}))}};
  const client={from:()=>chain,rpc:async(name,args)=>{
   try {
    const row=name==='claim_product_import'
     ? await one('select public.claim_product_import($1) data',[args.p_id])
     : await one('select public.finish_product_import($1,$2,$3,$4,$5) data',[args.p_id,args.p_lease_id,args.p_product,args.p_offer,args.p_observation]);
    return {data:row.data,error:null};
   } catch(error){return {data:null,error:{message:error.message}}}
  }};
  await imports.processImport(client,id,{checkUrlImpl:async url=>({allowed:true,url}),scrapeImpl:async()=>({price:99,currency:'EUR',availability:'in_stock',confidence:.95,title:'Phone'})});
  const job=await one('select * from product_import_jobs where id=$1',[id]);
  expect(job.status).toBe('done');expect(job.result.product.current_price).toBe(99);expect(job.result.product.user_id).toBe(uid);
  expect(await count('products')).toBe(1);expect(await count('price_history')).toBe(1);
  await imports.processImport(client,id,{scrapeImpl:async()=>{throw Error('must not run twice')}});
  expect(await count('products')).toBe(1);
 });
 it('deduplicates asynchronous additions, atomically saves the result and cannot create a second product on replay',async()=>{
  const id=randomUUID(),request={url:'https://shop.example/phone',targetPrice:null,monitoringUntil:null};
  const enqueue=async(id)=> (await one('select public.enqueue_product_import($1,$2,$3) j',[id,uid,request])).j;
  const job=await enqueue(id);expect((await enqueue(id)).id).toBe(id);expect((await enqueue(randomUUID())).id).toBe(id);
  const lease=(await one('select public.claim_product_import($1) j',[id])).j;
  expect((await one('select public.claim_product_import($1) j',[id])).j).toBeNull();
  const args=[id,lease.lease_id,{user_id:uid,url:request.url,name:'Phone',current_price:99,currency:'EUR',availability:'in_stock'},{offerKey:'default',url:request.url},{confidence:.95}];
  const result=(await one('select public.finish_product_import($1,$2,$3,$4,$5) p',args)).p;
  expect((await one('select public.finish_product_import($1,$2,$3,$4,$5) p',args)).p.id).toBe(result.id);
  expect(await count('products')).toBe(1);expect(await count('price_history')).toBe(1);expect(await count('price_observations')).toBe(1);
  const saved=await one('select status,result from product_import_jobs where id=$1',[id]);expect(saved.status).toBe('done');expect(saved.result.product.id).toBe(result.id);
 });
 it('rolls back an untrusted asynchronous addition and rejects an expired worker lease',async()=>{
  const id=randomUUID();await one('select public.enqueue_product_import($1,$2,$3)',[id,uid,{url:'https://shop.example/phone'}]);
  const lease=(await one('select public.claim_product_import($1) j',[id])).j;
  const args=[id,lease.lease_id,{user_id:uid,url:'https://shop.example/phone',current_price:99},{offerKey:'default'},{confidence:.3}];
  await expect(db.query('select public.finish_product_import($1,$2,$3,$4,$5)',args)).rejects.toThrow('Untrusted');
  expect(await count('products')).toBe(0);expect((await one('select status from product_import_jobs where id=$1',[id])).status).toBe('running');
  await db.query("update product_import_jobs set claimed_at=now()-interval '4 minutes' where id=$1",[id]);
  const next=(await one('select public.claim_product_import($1) j',[id])).j;expect(next.lease_id).not.toBe(lease.lease_id);
  await expect(db.query('select public.finish_product_import($1,$2,$3,$4,$5)',args)).rejects.toThrow('STALE_IMPORT_LEASE');
 });
 it('cannot reuse another user’s import request identifier or complete a job for another owner',async()=>{
  const id=randomUUID();await one('select public.enqueue_product_import($1,$2,$3)',[id,uid,{url:'https://shop.example/phone'}]);
  await expect(db.query('select public.enqueue_product_import($1,$2,$3)',[id,randomUUID(),{url:'https://shop.example/phone'}])).rejects.toThrow('IMPORT_REQUEST_CONFLICT');
  const job=(await one('select public.claim_product_import($1) j',[id])).j;
  await expect(db.query('select public.finish_product_import($1,$2,$3,$4,$5)',[id,job.lease_id,{user_id:randomUUID(),current_price:99},{offerKey:'default'},{confidence:.95}])).rejects.toThrow('IMPORT_OWNER_MISMATCH');
  expect(await count('products')).toBe(0);
 });
 it('creates product, pinned offer, first observation and first chart point together',async()=>{
  const p=await create();expect(p.primary_offer_id).toBeTruthy();expect(await count('price_history')).toBe(1);expect(await count('price_observations')).toBe(1);
 });
 it('rejects untrusted first readings without leaving partial products',async()=>{
  await expect(db.query('select public.create_tracked_product($1,$2,$3)',[{user_id:uid,url:'https://shop.example',current_price:99},{offerKey:'default'},{confidence:.35}])).rejects.toThrow('Untrusted');
  expect(await count('products')).toBe(0);
 });
 it('records exactly one target alert and one outbox event; rejects a concurrent stale check',async()=>{
  const p=await create();const result=await check(p);expect(result.notified).toBe(true);
  await expect(check(p)).rejects.toThrow('STALE_PRICE_CHECK');
  expect(await count('notifications')).toBe(1);expect(await count('notification_outbox')).toBe(1);expect(await count('scrape_runs')).toBe(1);
 });
 it('a one-cent change is recorded using decimal amounts',async()=>{
  const p=await create();expect((await check(p,728.99)).priceChanged).toBe(true);expect(await count('price_history')).toBe(2);
 });
 it('does not announce an unavailable deal',async()=>{
  const p=await create();expect((await check(p,699,{availability:'out_of_stock'})).notified).toBe(false);
  expect(await count('notifications')).toBe(0);
 });
 it('respects email preference independently of in-app alerts',async()=>{
  const p=await create();await db.query('update user_settings set email_notifications=false where user_id=$1',[uid]);
  expect((await check(p)).notified).toBe(true);expect(await count('notifications')).toBe(1);expect(await count('notification_outbox')).toBe(0);
 });
 it('a rejected reading preserves price, history and last successful verification',async()=>{
  const p=await create();await check(p,4.99,{accepted:false,reject_reason:'variazione_implausibile'});
  const stored=await one('select * from products where id=$1',[p.id]);
  expect(Number(stored.current_price)).toBe(729);expect(stored.last_success_at).toEqual(new Date(p.last_success_at));expect(stored.tracking_health).toBe('degraded');
  expect(await count('price_history')).toBe(1);expect(await count('price_observations')).toBe(2);
 });
 it('rolls back observations, price, alerts and offers if any write fails',async()=>{
  const p=await create();
  await db.exec("create function reject_history() returns trigger language plpgsql as $$begin raise exception 'simulated disk error';end$$;create trigger test_reject before insert on price_history for each row execute function reject_history();");
  try {await expect(check(p)).rejects.toThrow('simulated disk error');} finally {await db.exec('drop trigger test_reject on price_history;drop function reject_history()');}
  expect(Number((await one('select current_price from products where id=$1',[p.id])).current_price)).toBe(729);
  expect(await count('price_observations')).toBe(1);expect(await count('scrape_runs')).toBe(0);expect(await count('notifications')).toBe(0);
 });
 it('leases email delivery atomically and recovers an abandoned lease',async()=>{
  await check(await create());const first=(await db.query('select * from claim_notification_emails(1)')).rows;
  expect(first).toHaveLength(1);expect((await db.query('select * from claim_notification_emails(1)')).rows).toHaveLength(0);
  await db.exec("update notification_outbox set claimed_at=now()-interval '6 minutes'");
  const second=(await db.query('select * from claim_notification_emails(1)')).rows;
  expect(second[0].id).toBe(first[0].id);expect(second[0].lease_id).not.toBe(first[0].lease_id);
 });
 it('coordinates domain limits across callers',async()=>{
  expect((await one("select reserve_scrape_domain('amazon.it',10000) result")).result.allowed).toBe(true);
  const second=(await one("select reserve_scrape_domain('amazon.it',10000) result")).result;
  expect(second.allowed).toBe(false);expect(second.waitMs).toBeGreaterThan(0);
 });
 it('promotes candidate recipes with an atomic replacement of the active version',async()=>{
  await db.exec("insert into scrape_recipes(domain,version,status,origin,fields) values('test.example',1,'active','manual','{}');insert into scrape_recipes(domain,version,status,origin,fields,success_count) values('test.example',2,'candidate','learned','{}',2)");
  const candidate=await one("select * from scrape_recipes where domain='test.example' and version=2");
  expect((await one('select record_recipe_evaluation($1,true) result',[candidate.id])).result.promoted).toBe(true);
  expect((await one("select status from scrape_recipes where domain='test.example' and version=1")).status).toBe('deprecated');
 });
 it('does not expose write RPCs to authenticated or anonymous clients',async()=>{
  const row=await one("select has_function_privilege('authenticated','public.apply_price_check(uuid,timestamptz,jsonb,jsonb,jsonb,jsonb)','EXECUTE') allowed");expect(row.allowed).toBe(false);
 });
});
