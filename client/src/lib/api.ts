import { supabase } from './supabase'
import { waitForImport, type ImportStatus } from './importPolling'

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
  timeoutMs?: number
}

/**
 * Ogni chiamata porta il token di sessione: il server decide cosa scrivere,
 * il client non tocca piu' direttamente products e price_history.
 */
async function request<T = Record<string, unknown>>(path: string, { method = 'GET', body, timeoutMs }: RequestOptions = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    throw new ApiError(typeof payload.error === 'string' ? payload.error : response.status === 504 ? 'Il server non ha risposto in tempo. Riprova tra poco.' : 'Richiesta non riuscita', response.status, payload)
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
export async function addProduct({ url, targetPrice = null, monitoringUntil = null }: {
  url: string
  targetPrice?: number | null
  monitoringUntil?: string | null
}) {
  const { data: { session } } = await supabase.auth.getSession()
  const key = `price-tracker-import:${session?.user.id}:${JSON.stringify({ url, targetPrice, monitoringUntil })}`
  let pending: { requestId: string; jobId?: string } = { requestId: crypto.randomUUID() }
  try { pending = JSON.parse(sessionStorage.getItem(key) || 'null') || pending } catch { /* Storage can be disabled. */ }
  const save = () => { try { sessionStorage.setItem(key, JSON.stringify(pending)) } catch { /* Keep the in-memory request. */ } }
  save()
  if (!pending.jobId) {
    const queued = await request<{ jobId: string }>('/products', { method: 'POST', timeoutMs: 20000,
      body: { url, targetPrice, monitoringUntil, requestId: pending.requestId, async: true } })
    pending.jobId = queued.jobId
    save()
  }
  const job = await waitForImport(pending.jobId, id => request<ImportStatus>(`/product-imports/${id}`, { timeoutMs: 10000 }))
  try { sessionStorage.removeItem(key) } catch { /* Storage can be disabled. */ }
  if (job.status === 'failed') {
    throw new ApiError(job.error?.error || 'Aggiunta del prodotto fallita', job.error?.status || 500, job.error || {})
  }
  return job.result || {}
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
	if (reasons.includes('prezzo_non_caricato')) return 'La scheda è stata caricata, ma il prezzo non è diventato disponibile nel tempo di attesa. Riprova tra poco.'
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
