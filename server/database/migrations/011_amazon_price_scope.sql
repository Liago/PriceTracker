-- 011 - Restringe i selettori di prezzo di Amazon e aggiunge la disponibilita'.
--
-- Perche'. Una pagina prodotto Amazon contiene decine di prezzi che non sono
-- il prezzo del prodotto: sponsorizzati in testa, "Compra insieme", correlati,
-- varianti, offerte di terzi. L'ultimo fallback della ricetta seminata era
-- `.a-price .a-offscreen` senza ambito, e l'applicatore risolve con .first():
-- il primo prezzo della pagina, che e' spesso uno sponsorizzato.
--
-- In produzione questo ha prodotto il caso peggiore possibile - non un errore
-- visibile, ma un dato sbagliato accettato con fiducia: una sedia da 379,99
-- registrata a 109,83, con tracking_health 'healthy' e nessun fallimento in
-- vista, perche' un numero il selettore lo trovava sempre.
--
-- Ora ogni fallback resta dentro la colonna centrale del prodotto. Se nessuno
-- corrisponde non si legge nulla, ed e' il comportamento voluto: il motore ha
-- gia' il modo di dire «non ho letto il prezzo», mentre non ha nessun modo di
-- accorgersi di aver letto il prezzo di un altro prodotto.
--
-- Si aggiunge anche il campo availability, che mancava del tutto: senza, la
-- disponibilita' di ogni prodotto Amazon restava 'unknown' per sempre.
--
-- Idempotente: aggiorna le righe seminate dei domini Amazon e ne alza la
-- versione solo se i campi sono davvero cambiati.

update public.scrape_recipes
set
  fields = '{
    "price": {
      "strategy": "jsonld",
      "fallbacks": [
        {"strategy": "meta", "key": "product:price:amount"},
        {"strategy": "css", "selector": "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen", "attr": null},
        {"strategy": "css", "selector": "#corePrice_feature_div .a-price .a-offscreen", "attr": null},
        {"strategy": "css", "selector": "#apex_desktop .a-price .a-offscreen", "attr": null},
        {"strategy": "css", "selector": "#centerCol .apexPriceToPay .a-offscreen", "attr": null},
        {"strategy": "css", "selector": "#centerCol .a-price .a-offscreen", "attr": null}
      ]
    },
    "title": {
      "strategy": "css", "selector": "#productTitle", "attr": null,
      "fallbacks": [{"strategy": "meta", "key": "og:title"}]
    },
    "image": {
      "strategy": "meta", "key": "og:image",
      "fallbacks": [{"strategy": "css", "selector": "#landingImage", "attr": "src"}]
    },
    "currency": {"strategy": "meta", "key": "product:price:currency"},
    "availability": {
      "strategy": "css", "selector": "#availability", "attr": null,
      "fallbacks": [
        {"strategy": "css", "selector": "#availabilityInsideBuyBox_feature_div", "attr": null},
        {"strategy": "jsonld"}
      ]
    }
  }'::jsonb,
  version = version + 1,
  updated_at = now()
where origin = 'seeded'
  and domain in ('amazon.it', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es')
  and fields->'price'->'fallbacks' @> '[{"selector": ".a-price .a-offscreen"}]'::jsonb;

comment on column public.scrape_recipes.fields is
  'Come si leggono i campi di una pagina di questo dominio. I selettori CSS devono restare nell''ambito del prodotto principale: un selettore globale trova sempre un numero, e un numero sbagliato e'' peggio di nessun numero.';
