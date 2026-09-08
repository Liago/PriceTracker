-- 006 - Converte i tredici scraper dedicati in righe di ricetta.
--
-- E' il passaggio che rende possibile la fase 5, cioe' eliminare le classi in
-- server/services/scrapers/: la conoscenza che oggi vive nel codice diventa
-- dato, e da qui in poi si aggiorna senza un deploy.
--
-- Criterio di sicurezza. Le ricette seminate usano solo strategie
-- AUTO-VALIDANTI: jsonld, microdata e meta non inventano nulla quando la
-- pagina non le espone, semplicemente non producono candidati, e il motore
-- ripiega da solo sulla scoperta completa. I selettori CSS trascritti a mano
-- dagli scraper - che non ho potuto provare contro pagine reali - entrano solo
-- come FALLBACK, quindi si attivano dopo che le sorgenti strutturate hanno
-- gia' fallito, e restano comunque soggetti alla soglia di confidenza.
--
-- Dieci dei tredici scraper leggono gia' il JSON-LD, quindi per loro la
-- ricetta seminata descrive cio' che facevano davvero.
--
-- Idempotente: usa una chiave naturale e non duplica.

-- PROFILI DI DOMINIO -------------------------------------------------------

insert into public.domain_profiles (domain, locale, default_currency, transport, requires_js)
values
  ('amazon.it',          'it-IT', 'EUR', 'browser', true),
  ('amazon.com',         'en-US', 'USD', 'browser', true),
  ('amazon.co.uk',       'en-GB', 'GBP', 'browser', true),
  ('amazon.de',          'de-DE', 'EUR', 'browser', true),
  ('amazon.fr',          'fr-FR', 'EUR', 'browser', true),
  ('amazon.es',          'es-ES', 'EUR', 'browser', true),
  ('mediaworld.it',      'it-IT', 'EUR', 'browser', true),
  ('unieuro.it',         'it-IT', 'EUR', 'browser', true),
  ('eprice.it',          'it-IT', 'EUR', 'browser', true),
  ('ebay.it',            'it-IT', 'EUR', 'browser', true),
  ('zalando.it',         'it-IT', 'EUR', 'browser', true),
  ('backmarket.it',      'it-IT', 'EUR', 'browser', true),
  ('refurbed.it',        'it-IT', 'EUR', 'browser', true),
  ('swappie.com',        'it-IT', 'EUR', 'browser', true),
  ('juice.it',           'it-IT', 'EUR', 'browser', true),
  ('smartgeneration.it', 'it-IT', 'EUR', 'browser', true),
  ('rework-labs.com',    'it-IT', 'EUR', 'browser', true),
  ('aliexpress.com',     'it-IT', 'EUR', 'browser', true)
on conflict (domain) do nothing;

-- RICETTE SEMINATE ---------------------------------------------------------

-- Dieci store leggono il JSON-LD: la ricetta registra questo, con i meta
-- Open Graph come rete di sicurezza.
insert into public.scrape_recipes (domain, url_pattern, scope, version, status, origin, transport, fields, confidence)
select
  d.domain, '*', 'domain', 1, 'active', 'seeded', 'browser',
  jsonb_build_object(
    'price', jsonb_build_object(
      'strategy', 'jsonld',
      'fallbacks', jsonb_build_array(
        jsonb_build_object('strategy', 'microdata', 'selector', '[itemprop="price"]', 'attr', 'content'),
        jsonb_build_object('strategy', 'meta', 'key', 'product:price:amount')
      )
    ),
    'currency',     jsonb_build_object('strategy', 'jsonld'),
    'availability', jsonb_build_object('strategy', 'jsonld'),
    'title',        jsonb_build_object('strategy', 'jsonld'),
    'image',        jsonb_build_object('strategy', 'jsonld'),
    'sku',          jsonb_build_object('strategy', 'jsonld'),
    'brand',        jsonb_build_object('strategy', 'jsonld')
  ),
  0.9
from (values
  ('mediaworld.it'), ('unieuro.it'), ('eprice.it'), ('ebay.it'), ('zalando.it'),
  ('backmarket.it'), ('refurbed.it'), ('juice.it'), ('smartgeneration.it'), ('aliexpress.com')
) as d(domain)
where not exists (
  select 1 from public.scrape_recipes r
   where r.domain = d.domain and r.url_pattern = '*' and r.scope = 'domain'
);

-- Amazon non espone un JSON-LD Product utilizzabile: AmazonScraper legge una
-- lista di selettori. Vengono trascritti come fallback, dopo le sorgenti
-- strutturate, perche' non ho potuto verificarli contro pagine reali.
insert into public.scrape_recipes (domain, url_pattern, scope, version, status, origin, transport, fields, confidence)
select
  d.domain, '*', 'domain', 1, 'active', 'seeded', 'browser',
  jsonb_build_object(
    'price', jsonb_build_object(
      'strategy', 'jsonld',
      'fallbacks', jsonb_build_array(
        jsonb_build_object('strategy', 'meta', 'key', 'product:price:amount'),
        jsonb_build_object('strategy', 'css', 'selector', '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', 'attr', null),
        jsonb_build_object('strategy', 'css', 'selector', '.apexPriceToPay .a-offscreen', 'attr', null),
        jsonb_build_object('strategy', 'css', 'selector', '.a-price .a-offscreen', 'attr', null)
      )
    ),
    'title', jsonb_build_object(
      'strategy', 'css', 'selector', '#productTitle', 'attr', null,
      'fallbacks', jsonb_build_array(jsonb_build_object('strategy', 'meta', 'key', 'og:title'))
    ),
    'image', jsonb_build_object(
      'strategy', 'meta', 'key', 'og:image',
      'fallbacks', jsonb_build_array(jsonb_build_object('strategy', 'css', 'selector', '#landingImage', 'attr', 'src'))
    ),
    'currency', jsonb_build_object('strategy', 'meta', 'key', 'product:price:currency')
  ),
  0.8
from (values
  ('amazon.it'), ('amazon.com'), ('amazon.co.uk'), ('amazon.de'), ('amazon.fr'), ('amazon.es')
) as d(domain)
where not exists (
  select 1 from public.scrape_recipes r
   where r.domain = d.domain and r.url_pattern = '*' and r.scope = 'domain'
);

-- Swappie e Rework Labs: i rispettivi scraper si appoggiano ai meta Open
-- Graph, non al JSON-LD.
insert into public.scrape_recipes (domain, url_pattern, scope, version, status, origin, transport, fields, confidence)
select
  d.domain, '*', 'domain', 1, 'active', 'seeded', 'browser',
  jsonb_build_object(
    'price', jsonb_build_object(
      'strategy', 'meta', 'key', 'product:price:amount',
      'fallbacks', jsonb_build_array(jsonb_build_object('strategy', 'jsonld'))
    ),
    'currency', jsonb_build_object('strategy', 'meta', 'key', 'product:price:currency'),
    'title',    jsonb_build_object('strategy', 'meta', 'key', 'og:title'),
    'image',    jsonb_build_object('strategy', 'meta', 'key', 'og:image')
  ),
  0.7
from (values ('swappie.com'), ('rework-labs.com')) as d(domain)
where not exists (
  select 1 from public.scrape_recipes r
   where r.domain = d.domain and r.url_pattern = '*' and r.scope = 'domain'
);
