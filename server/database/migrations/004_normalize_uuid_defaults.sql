-- 004 - Uniforma il default delle chiavi primarie a gen_random_uuid().
--
-- I file SQL originali usavano uuid_generate_v4(), che vive nell'estensione
-- uuid-ossp: Supabase la abilita di default, un Postgres standard no. Un
-- database ricreato da zero finiva quindi con default diversi da quello di
-- produzione, e le migrazioni non giravano fuori da Supabase.
--
-- gen_random_uuid() e' integrata in Postgres dalla 13 e genera UUID v4 come
-- la precedente. Il cambio riguarda solo le righe future: quelle esistenti
-- mantengono il loro id.
--
-- Idempotente: puo' essere rieseguita senza effetti.

alter table public.products      alter column id set default gen_random_uuid();
alter table public.price_history alter column id set default gen_random_uuid();
alter table public.notifications alter column id set default gen_random_uuid();
alter table public.user_settings alter column id set default gen_random_uuid();

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'supported_domains') then
    alter table public.supported_domains alter column id set default gen_random_uuid();
  end if;
end $$;
