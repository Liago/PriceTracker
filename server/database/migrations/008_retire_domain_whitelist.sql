-- 008 - Ritira la whitelist dei domini.
--
-- supported_domains era il controllo che rendeva impossibile per costruzione
-- l'obiettivo del refactor: un URL di uno shop non elencato veniva rifiutato
-- (difetto D1). Il codice non la interroga piu': al suo posto ci sono
-- scrape/policy/urlPolicy.js - che verifica che l'URL sia sicuro da visitare,
-- non che il dominio sia in un elenco - e domain_profiles, che chiude per
-- eccezione tramite block_reason.
--
-- La tabella non viene eliminata: i domini che conteneva vengono riversati in
-- domain_profiles, cosi' nulla di cio' che l'utente aveva aggiunto va perso, e
-- la tabella resta come reperto finche' anche la UI e' migrata.
--
-- Idempotente: puo' essere rieseguita senza effetti.

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'supported_domains'
  ) then
    insert into public.domain_profiles (domain, transport, requires_js)
    select lower(regexp_replace(domain, '^www\.', '')), 'browser', true
      from public.supported_domains
    on conflict (domain) do nothing;

    comment on table public.supported_domains is
      'SUPERATA dalla migrazione 008. Il motore non la interroga piu'': l''accesso e'' regolato da urlPolicy (sicurezza) e domain_profiles (blocchi per eccezione). Conservata come reperto.';
  end if;
end $$;
