-- Transactional tracking, shared domain reservations and recoverable email delivery.
alter table public.products add column if not exists last_price_change_at timestamptz;
alter table public.notifications add column if not exists observation_id uuid references public.price_observations(id) on delete set null;
create unique index if not exists idx_notification_observation on public.notifications(observation_id) where observation_id is not null;

create table if not exists public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null unique references public.notifications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 payload jsonb not null,
 status text not null default 'pending' check (status in ('pending','sending','sent','dead','skipped')),
 attempts integer not null default 0,
 run_after timestamptz not null default now(),
 claimed_at timestamptz,
 lease_id uuid,
 sent_at timestamptz,
 last_error text
);
alter table public.notification_outbox enable row level security;
grant all on public.notification_outbox to service_role;
create index if not exists idx_outbox_pending on public.notification_outbox(run_after) where status in ('pending','sending');

create or replace function public.create_tracked_product(p_product jsonb, p_offer jsonb, p_observation jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products; o public.product_offers; t timestamptz := now();
begin
 if p_product->>'current_price' is null or (p_product->>'current_price')::numeric <= 0 or coalesce((p_observation->>'confidence')::numeric,0) < 0.85 then
  raise exception 'Untrusted initial price';
 end if;
 insert into public.products(user_id,url,canonical_url,domain,name,image,description,current_price,currency,target_price,monitoring_until,store,brand,sku,gtin,details,tracking_health,last_success_at,last_checked_at,availability,last_price_change_at)
 values ((p_product->>'user_id')::uuid,p_product->>'url',p_product->>'canonical_url',p_product->>'domain',p_product->>'name',p_product->>'image',p_product->>'description',
 (p_product->>'current_price')::numeric,p_product->>'currency',(p_product->>'target_price')::numeric,(p_product->>'monitoring_until')::date,p_product->>'store',p_product->>'brand',p_product->>'sku',p_product->>'gtin',coalesce(p_product->'details','{}'), 'healthy',t,t,p_product->>'availability',t)
 returning * into p;
 insert into public.product_offers(product_id,offer_key,variant,seller,condition,sku,gtin,url,is_primary,current_price,currency,availability,last_seen_at)
 values(p.id,p_offer->>'offerKey',coalesce(p_offer->'variant','{}'),p_offer->>'seller',p_offer->>'condition',p_offer->>'sku',p_offer->>'gtin',p_offer->>'url',true,p.current_price,p.currency,p.availability,t) returning * into o;
 update public.products set primary_offer_id=o.id where id=p.id returning * into p;
 insert into public.price_observations(product_id,offer_id,price,currency,availability,confidence,accepted,observed_at)
 values(p.id,o.id,p.current_price,p.currency,p.availability,(p_observation->>'confidence')::numeric,true,t);
 insert into public.price_history(product_id,price,recorded_at) values(p.id,p.current_price,t);
 return to_jsonb(p);
end $$;

create or replace function public.apply_price_check(p_product_id uuid,p_expected_checked_at timestamptz,p_offer jsonb,p_observation jsonb,p_patch jsonb,p_run jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products; o public.product_offers; obs public.price_observations; rid uuid; nid uuid;
 accepted boolean := coalesce((p_observation->>'accepted')::boolean,false);
 changed boolean := false; notified boolean := false; price numeric := (p_observation->>'price')::numeric;
 t timestamptz := (p_observation->>'observed_at')::timestamptz;
begin
 select * into strict p from public.products where id=p_product_id for update;
 if p.last_checked_at is distinct from p_expected_checked_at then raise exception 'STALE_PRICE_CHECK'; end if;
 if accepted and (price is null or price <= 0 or coalesce((p_observation->>'confidence')::numeric,0) < 0.60) then raise exception 'Untrusted price'; end if;
 if accepted then
  select * into o from public.product_offers where product_id=p.id and offer_key=p_offer->>'offerKey';
  if o.id is null then
   insert into public.product_offers(product_id,offer_key,variant,seller,condition,sku,gtin,url,is_primary)
   values(p.id,p_offer->>'offerKey',coalesce(p_offer->'variant','{}'),p_offer->>'seller',p_offer->>'condition',p_offer->>'sku',p_offer->>'gtin',p_offer->>'url',false) returning * into o;
  end if;
 else
  select * into o from public.product_offers where id=p.primary_offer_id;
 end if;
 insert into public.scrape_runs(product_id,url,domain,status,duration_ms,winning_source,confidence,result,validation,error_message,extractors_ran,candidates)
 values(p.id,p.url,p_run->>'domain',p_run->>'status',(p_run->>'duration_ms')::integer,p_run->>'winning_source',(p_run->>'confidence')::numeric,p_run->'result',p_run->'validation',p_run->>'error_message',coalesce(p_run->'extractors_ran','[]'),coalesce(p_run->'candidates','[]')) returning id into rid;
 insert into public.price_observations(id,product_id,offer_id,run_id,price,currency,availability,confidence,accepted,reject_reason,observed_at)
 values((p_observation->>'id')::uuid,p.id,o.id,rid,price,p_observation->>'currency',p_observation->>'availability',(p_observation->>'confidence')::numeric,accepted,p_observation->>'reject_reason',t) returning * into obs;
 if accepted then
  changed := p.current_price is distinct from price;
  update public.product_offers set is_primary=false where product_id=p.id and is_primary and id<>o.id;
  update public.product_offers set is_primary=true,current_price=price,currency=obs.currency,availability=obs.availability,last_seen_at=t where id=o.id;
  if changed or not exists(select 1 from public.price_history where product_id=p.id) then
   insert into public.price_history(product_id,price,recorded_at) values(p.id,price,t);
  end if;
  if changed and p.current_price > p.target_price and price <= p.target_price and obs.availability='in_stock' then
   insert into public.notifications(user_id,product_id,type,old_price,new_price,observation_id)
   values(p.user_id,p.id,'price_drop',p.current_price,price,obs.id) returning id into nid;
   notified := true;
   if coalesce((select email_notifications from public.user_settings where user_id=p.user_id),true) then
    insert into public.notification_outbox(notification_id,user_id,payload)
    values(nid,p.user_id,jsonb_build_object('product',to_jsonb(p),'oldPrice',p.current_price,'newPrice',price));
   end if;
  end if;
 end if;
 update public.products set
 last_checked_at=t, tracking_health=p_patch->>'tracking_health',consecutive_failures=(p_patch->>'consecutive_failures')::integer,
 availability=coalesce(p_patch->>'availability',availability),
 details=case when accepted then jsonb_set(coalesce(details,'{}'),'{variant}',coalesce(p_offer->'variant','{}')) else details end,
 current_price=case when accepted then price else current_price end,
 currency=case when accepted then coalesce(obs.currency,currency) else currency end,
 last_success_at=case when accepted then t else last_success_at end,
 last_price_change_at=case when accepted and changed then t else last_price_change_at end,
 primary_offer_id=case when accepted then o.id else primary_offer_id end,
 sku=case when accepted then coalesce(sku,p_offer->>'sku') else sku end,
 gtin=case when accepted then coalesce(gtin,p_offer->>'gtin') else gtin end
 where id=p.id;
 return jsonb_build_object('offerId',o.id,'priceChanged',accepted and changed,'notified',notified);
end $$;

create table if not exists public.scrape_domain_slots(domain text primary key,next_at timestamptz not null default now());
alter table public.scrape_domain_slots enable row level security;
grant all on public.scrape_domain_slots to service_role;
create or replace function public.reserve_scrape_domain(p_domain text,p_interval_ms integer default 10000)
returns jsonb language plpgsql security definer set search_path=public as $$
declare slot public.scrape_domain_slots; t timestamptz := clock_timestamp();
begin
 insert into public.scrape_domain_slots(domain,next_at) values(p_domain,t) on conflict do nothing;
 select * into slot from public.scrape_domain_slots where domain=p_domain for update;
 if slot.next_at>t then return jsonb_build_object('allowed',false,'waitMs',ceil(extract(epoch from(slot.next_at-t))*1000)); end if;
 update public.scrape_domain_slots set next_at=t+greatest(p_interval_ms,1000)*interval '1 millisecond' where domain=p_domain;
 return jsonb_build_object('allowed',true,'waitMs',0);
end $$;

create or replace function public.claim_notification_emails(p_limit integer default 3)
returns setof public.notification_outbox language plpgsql security definer set search_path=public as $$
begin
 return query with jobs as (
  select id from public.notification_outbox where (status='pending' and run_after<=now()) or (status='sending' and claimed_at<now()-interval '5 minutes')
  order by run_after limit least(greatest(p_limit,1),10) for update skip locked
 ) update public.notification_outbox o set status='sending',attempts=o.attempts+1,claimed_at=now(),lease_id=gen_random_uuid()
 from jobs where o.id=jobs.id returning o.*;
end $$;

-- Functions callable only by the backend, never by an anon/authenticated session.
revoke all on function public.create_tracked_product(jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.apply_price_check(uuid,timestamptz,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_scrape_domain(text,integer) from public,anon,authenticated;
revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.create_tracked_product(jsonb,jsonb,jsonb),public.apply_price_check(uuid,timestamptz,jsonb,jsonb,jsonb,jsonb),public.reserve_scrape_domain(text,integer),public.claim_notification_emails(integer) to service_role;
-- Preserve existing prices/history, but request a verified reading of affected stores.
update public.products set tracking_health='degraded' where tracking_health='healthy' and (domain like 'amazon.%' or domain='swappie.com' or url like '%amazon.%' or url like '%swappie.com%');

create or replace function public.record_recipe_evaluation(p_recipe_id uuid,p_succeeded boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.scrape_recipes; next_status text;
begin
 -- Serialize promotions per domain before locking a particular version.
 perform pg_advisory_xact_lock(hashtextextended((select domain from public.scrape_recipes where id=p_recipe_id),0));
 select * into strict r from public.scrape_recipes where id=p_recipe_id for update;
 if r.status not in ('active','candidate') then return jsonb_build_object('status',r.status); end if;
 next_status := r.status;
 if not p_succeeded and r.consecutive_failures+1>=3 then next_status:='quarantined'; end if;
 if p_succeeded and r.status='candidate' and r.success_count+1>=3 then
  update public.scrape_recipes set status='deprecated',updated_at=now()
  where domain=r.domain and scope=r.scope and url_pattern=r.url_pattern and product_id is not distinct from r.product_id and status='active';
  next_status:='active';
 end if;
 update public.scrape_recipes set status=next_status,success_count=success_count+case when p_succeeded then 1 else 0 end,
 failure_count=failure_count+case when p_succeeded then 0 else 1 end,
 consecutive_failures=case when p_succeeded then 0 else consecutive_failures+1 end,
 last_success_at=case when p_succeeded then now() else last_success_at end,
 last_failure_at=case when p_succeeded then last_failure_at else now() end,updated_at=now() where id=r.id;
 return jsonb_build_object('status',next_status,'promoted',next_status='active' and r.status<>'active','quarantined',next_status='quarantined');
end $$;
revoke all on function public.record_recipe_evaluation(uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_recipe_evaluation(uuid,boolean) to service_role;

create or replace function public.tracking_schema_version() returns integer language sql stable as $$ select 12 $$;
revoke all on function public.tracking_schema_version() from public,anon,authenticated;
grant execute on function public.tracking_schema_version() to service_role;
