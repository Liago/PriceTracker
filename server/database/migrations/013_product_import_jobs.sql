-- Durable asynchronous product additions; a lease and atomic completion prevent duplicates.
create table if not exists public.product_import_jobs (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 request jsonb not null,
 request_key text not null,
 status text not null default 'pending' check(status in ('pending','running','done','failed')),
 lease_id uuid,
 claimed_at timestamptz,
 result jsonb,
 error jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists idx_import_active_request on public.product_import_jobs(user_id,request_key) where status in ('pending','running');
alter table public.product_import_jobs enable row level security;
grant all on public.product_import_jobs to service_role;

create or replace function public.enqueue_product_import(p_id uuid,p_user_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.product_import_jobs;
begin
 select * into j from public.product_import_jobs where id=p_id;
 if found then
  if j.user_id<>p_user_id or j.request<>p_request then raise exception 'IMPORT_REQUEST_CONFLICT'; end if;
  return to_jsonb(j);
 end if;
 insert into public.product_import_jobs(id,user_id,request,request_key)
 values(p_id,p_user_id,p_request,md5(p_request::text))
 on conflict do nothing returning * into j;
 if not found then
  select * into j from public.product_import_jobs where user_id=p_user_id
   and (id=p_id or (request_key=md5(p_request::text) and status in ('pending','running')));
 end if;
 if j.id is null or j.request<>p_request then raise exception 'IMPORT_REQUEST_CONFLICT'; end if;
 return to_jsonb(j);
end $$;

create or replace function public.claim_product_import(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.product_import_jobs;
begin
 update public.product_import_jobs set status='running',lease_id=gen_random_uuid(),claimed_at=now(),updated_at=now()
 where id=p_id and (status='pending' or (status='running' and claimed_at<now()-interval '3 minutes')) returning * into j;
 return case when j.id is null then null else to_jsonb(j) end;
end $$;

create or replace function public.finish_product_import(p_id uuid,p_lease_id uuid,p_product jsonb,p_offer jsonb,p_observation jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.product_import_jobs; p jsonb;
begin
 select * into strict j from public.product_import_jobs where id=p_id for update;
 if j.status='done' then return j.result->'product'; end if;
 if j.status<>'running' or j.lease_id is distinct from p_lease_id then raise exception 'STALE_IMPORT_LEASE'; end if;
 if (p_product->>'user_id')::uuid is distinct from j.user_id then raise exception 'IMPORT_OWNER_MISMATCH'; end if;
 p := public.create_tracked_product(p_product,p_offer,p_observation);
 update public.product_import_jobs set status='done',result=jsonb_build_object('product',p,'confidence',p_observation->'confidence'),updated_at=now(),lease_id=null
 where id=p_id;
 return p;
end $$;

revoke all on function public.enqueue_product_import(uuid,uuid,jsonb),public.claim_product_import(uuid),public.finish_product_import(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_product_import(uuid,uuid,jsonb),public.claim_product_import(uuid),public.finish_product_import(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
create or replace function public.tracking_schema_version() returns integer language sql stable as $$select 13$$;
