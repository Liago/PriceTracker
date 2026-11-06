-- Sessioni anonime dei retailer con la posizione di consegna gia' impostata.
-- Cookie creati dal retailer stesso dopo un cambio di CAP riuscito: si
-- riusano per non ripeterlo a ogni lettura. Solo il service role li legge.
-- Facoltativa: senza questa tabella il motore reimposta il CAP ogni volta.
create table if not exists public.retailer_sessions (
 key text primary key,
 cookies jsonb not null,
 user_agent text,
 location text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
alter table public.retailer_sessions enable row level security;
revoke all on public.retailer_sessions from anon, authenticated;
grant all on public.retailer_sessions to service_role;
