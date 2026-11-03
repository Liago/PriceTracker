/**
 * Numeri e date, mostrati come li salva il database.
 *
 * La regola è "nessun numero cambia": un prezzo letto come 379.99 resta
 * 379.99, senza separatori delle migliaia né arrotondamenti. Questi helper
 * servono solo a sapere QUANTI decimali ha il valore, così il contatore
 * animato si ferma esattamente sul numero salvato.
 */

export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Quanti decimali ha un numero così come è scritto (379.9 → 1, 380 → 0). */
export function decimalsOf(value: number | string | null | undefined): number {
  const n = toNumber(value)
  if (n === null) return 0
  const text = String(typeof value === 'string' ? value.trim() : n)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 4)
}

/** Il prezzo come testo, identico al valore salvato. */
export function priceText(value: number | string | null | undefined): string {
  const n = toNumber(value)
  return n === null ? '—' : String(value)
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '—'
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—'
}
