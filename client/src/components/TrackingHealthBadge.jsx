import { AlertTriangle, CheckCircle2, HelpCircle, ShieldOff, XCircle } from 'lucide-react'

/**
 * Stato del tracking, a colpo d'occhio.
 *
 * Serve perche' il motore ora sa distinguere "prezzo stabile" da "non riesco
 * piu' a leggere questa pagina", e quella distinzione deve arrivare
 * all'utente: un prezzo fermo da tre settimane perche' lo scraper e' rotto
 * sembrava identico a uno davvero fermo.
 */
const STATES = {
  healthy: {
    label: 'Tracking ok',
    detail: 'L\'ultimo controllo è andato a buon fine.',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    Icon: CheckCircle2,
  },
  degraded: {
    label: 'Da verificare',
    detail: 'L\'ultimo controllo non ha prodotto un prezzo attendibile. Il prezzo mostrato è l\'ultimo valido.',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    Icon: AlertTriangle,
  },
  broken: {
    label: 'Non leggibile',
    detail: 'Il prezzo non viene letto da diversi controlli. Il valore mostrato potrebbe non essere aggiornato.',
    className: 'bg-red-500/10 text-red-400 border-red-500/30',
    Icon: XCircle,
  },
  blocked: {
    label: 'Sito bloccato',
    detail: 'Questo sito impedisce la lettura automatica delle pagine.',
    className: 'bg-red-500/10 text-red-400 border-red-500/30',
    Icon: ShieldOff,
  },
  unknown: {
    label: 'Mai controllato',
    detail: 'Non ci sono ancora controlli per questo prodotto.',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
    Icon: HelpCircle,
  },
}

export default function TrackingHealthBadge({ health, compact = false, className = '' }) {
  const state = STATES[health] || STATES.unknown
  const { Icon } = state

  if (compact) {
    return (
      <span
        title={`${state.label} — ${state.detail}`}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${state.className} ${className}`}
      >
        <Icon size={12} aria-hidden="true" />
        <span className="sr-only">{state.label}</span>
      </span>
    )
  }

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${state.className} ${className}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-medium">{state.label}</div>
        <div className="text-xs opacity-80 mt-0.5">{state.detail}</div>
      </div>
    </div>
  )
}
