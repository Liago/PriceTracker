import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
