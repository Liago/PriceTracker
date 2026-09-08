-- 002 - Allinea price_check_interval all'unita' realmente usata: minuti.
--
-- Contesto (difetto D9 del design doc): la UI presenta il campo come
-- "Price Check Interval (minutes)" con default 360, e il price tracker lo
-- moltiplica per 60000 per ottenere millisecondi - quindi minuti. Solo lo
-- schema lo dichiarava in ore con default 6.
--
-- Finche' getUserSettings() non restituiva il campo, il disallineamento era
-- innocuo: il tracker usava comunque 360. Ora che il valore viene applicato,
-- una riga legacy con 6 significherebbe un check ogni 6 minuti per ogni
-- prodotto di quell'utente.
--
-- Idempotente: puo' essere rieseguita senza effetti.

alter table public.user_settings
  alter column price_check_interval set default 360;

-- Riporta al default le righe con un intervallo implausibile, cioe' quelle
-- create quando il default era 6. Il valore 15 e' lo stesso pavimento che
-- applica server/services/userSettings.js.
update public.user_settings
   set price_check_interval = 360,
       updated_at = now()
 where price_check_interval is null
    or price_check_interval < 15;

comment on column public.user_settings.price_check_interval is
  'Minuti fra due controlli di prezzo. Minimo effettivo applicato dal server: 15.';
