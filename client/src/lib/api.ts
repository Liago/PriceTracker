import { supabase } from './supabase'

const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

/** Errore di una chiamata al server, con stato HTTP e payload originale. */
export class ApiError extends Error {
  status: number
  code?: string
  payload: Record<string, unknown>

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = typeof payload.code === 'string' ? payload.code : undefined
    this.payload = payload
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

/**
 * Ogni chiamata porta il token di sessione: il server decide cosa scrivere,
 * il client non tocca piu' direttamente products e price_history.
 */
async function request<T = Record<string, unknown>>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    throw new ApiError(typeof payload.error === 'string' ? payload.error : 'Request failed', response.status, payload)
  }

  return payload as T
}

export interface RefreshResult {
  accepted: boolean
  priceChanged?: boolean
  previousPrice?: number | string | null
  price?: number | string | null
  [key: string]: unknown
}

/** Analizza una pagina senza salvarla, per l'anteprima. */
export function scrapeProduct(url: string) {
  return request('/scrape', { method: 'POST', body: { url } })
}

/** Aggiunge un prodotto. La scrittura avviene sul server. */
export function addProduct({ url, targetPrice = null, monitoringUntil = null }: {
  url: string
  targetPrice?: number | null
  monitoringUntil?: string | null
}) {
  return request('/products', { method: 'POST', body: { url, targetPrice, monitoringUntil } })
}

/** Aggiorna un prodotto adesso, con la stessa validazione del controllo automatico. */
export function refreshProduct(productId: string) {
  return request<RefreshResult>(`/products/${productId}/refresh`, { method: 'POST' })
}

/** Stato di salute del tracking, con le ultime osservazioni. */
export interface ProductHealth {
  latestRun?: { validation?: { reasons?: string[] }; result?: { diagnostics?: { reason?: string; totalMs?: number } } } | null
}
export function getProductHealth(productId: string) {
  return request<ProductHealth>(`/products/${productId}/health`)
}

export function trackingMessage(reasons: string[] = []): string | undefined {
  if (reasons.includes('price_requires_cart')) return 'Amazon mostra il prezzo di questa offerta solo nel carrello. Il valore mostrato è l’ultimo verificato; i prezzi degli altri venditori non vengono usati al suo posto.'
  if (reasons.includes('main_price_unavailable')) return 'Amazon non espone un prezzo per l’offerta principale. Il valore mostrato è l’ultimo verificato.'
  if (reasons.includes('identita_cambiata')) return 'La pagina mostra una configurazione diversa da quella monitorata. Verifica il link della variante: memoria, colore, condizione e batteria.'
  if (reasons.some(reason => ['budget_insufficiente', 'budget_esaurito', 'budget_speso_nell_avvio', 'navigazione_troncata'].includes(reason))) return 'La lettura non è terminata nel tempo disponibile. Il prezzo mostrato è l’ultimo verificato; riprova tra poco.'
  return undefined
}

/** Segnala un campo estratto male. */
export function reportField({ productId, field, reported, expectedValue = null }: {
  productId: string
  field: string
  reported: string
  expectedValue?: string | null
}) {
  return request('/feedback', { method: 'POST', body: { productId, field, reported, expectedValue } })
}

/** Stato dei domini conosciuti dal motore. */
export function getDomains() {
  return request('/domains')
}

/** Il messaggio leggibile di un errore qualunque. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function trackingLabel(reasons: string[] = []): string | undefined {
  return reasons.includes('price_requires_cart') ? 'Prezzo solo nel carrello' : undefined
}
