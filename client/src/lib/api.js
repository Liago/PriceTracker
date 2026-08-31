import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

/**
 * Ogni chiamata porta il token di sessione: il server decide cosa scrivere,
 * il client non tocca piu' direttamente products e price_history.
 */
async function request(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed')
    error.status = response.status
    error.code = payload.code
    error.payload = payload
    throw error
  }

  return payload
}

/** Analizza una pagina senza salvarla, per l'anteprima. */
export function scrapeProduct(url) {
  return request('/scrape', { method: 'POST', body: { url } })
}

/** Aggiunge un prodotto. La scrittura avviene sul server. */
export function addProduct({ url, targetPrice = null, monitoringUntil = null }) {
  return request('/products', { method: 'POST', body: { url, targetPrice, monitoringUntil } })
}

/** Aggiorna un prodotto adesso, con la stessa validazione del controllo automatico. */
export function refreshProduct(productId) {
  return request(`/products/${productId}/refresh`, { method: 'POST' })
}

/** Stato di salute del tracking, con le ultime osservazioni. */
export function getProductHealth(productId) {
  return request(`/products/${productId}/health`)
}

/** Segnala un campo estratto male. */
export function reportField({ productId, field, reported, expectedValue = null }) {
  return request('/feedback', { method: 'POST', body: { productId, field, reported, expectedValue } })
}

/** Stato dei domini conosciuti dal motore. */
export function getDomains() {
  return request('/domains')
}
