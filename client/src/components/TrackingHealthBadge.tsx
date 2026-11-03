import { AlertTriangle, CheckCircle2, HelpCircle, ShieldOff, XCircle, type LucideIcon } from 'lucide-react'
import type { TrackingHealth } from '../lib/types'
import { Badge, type BadgeTone } from './ui/badge'
import { cn } from '../lib/utils'

/**
 * Stato del tracking, a colpo d'occhio.
 *
 * Serve perche' il motore ora sa distinguere "prezzo stabile" da "non riesco
 * piu' a leggere questa pagina", e quella distinzione deve arrivare
 * all'utente: un prezzo fermo da tre settimane perche' lo scraper e' rotto
 * sembrava identico a uno davvero fermo.
 */
interface HealthState {
  label: string
  detail: string
  tone: BadgeTone
  Icon: LucideIcon
}

// eslint-disable-next-line react-refresh/only-export-components
export const HEALTH_STATES: Record<TrackingHealth, HealthState> = {
  healthy: {
    label: 'Tracking ok',
    detail: 'L\'ultimo controllo è andato a buon fine.',
    tone: 'good',
    Icon: CheckCircle2,
  },
  degraded: {
    label: 'Da verificare',
    detail: 'L\'ultimo controllo non ha prodotto un prezzo attendibile. Il prezzo mostrato è l\'ultimo valido.',
    tone: 'watch',
    Icon: AlertTriangle,
  },
  broken: {
    label: 'Non leggibile',
    detail: 'Il prezzo non viene letto da diversi controlli. Il valore mostrato potrebbe non essere aggiornato.',
    tone: 'bad',
    Icon: XCircle,
  },
  blocked: {
    label: 'Sito bloccato',
    detail: 'Questo sito impedisce la lettura automatica delle pagine.',
    tone: 'bad',
    Icon: ShieldOff,
  },
  unknown: {
    label: 'Mai controllato',
    detail: 'Non ci sono ancora controlli per questo prodotto.',
    tone: 'neutral',
    Icon: HelpCircle,
  },
}

/** Gli stati che chiedono un'azione all'utente. */
// eslint-disable-next-line react-refresh/only-export-components
export function needsAttention(health: TrackingHealth | null | undefined): boolean {
  return health === 'degraded' || health === 'broken' || health === 'blocked'
}

interface Props {
  health: TrackingHealth | null | undefined
  compact?: boolean
  className?: string
}

export default function TrackingHealthBadge({ health, compact = false, className = '' }: Props) {
  const state = (health && HEALTH_STATES[health]) || HEALTH_STATES.unknown
  const { Icon } = state

  if (compact) {
    return (
      <Badge tone={state.tone} title={`${state.label} — ${state.detail}`} className={className}>
        <Icon size={13} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{state.label}</span>
      </Badge>
    )
  }

  const toneClass: Record<BadgeTone, string> = {
    good: 'bg-good-bg text-good',
    bad: 'bg-bad-bg text-bad',
    watch: 'bg-watch-bg text-watch',
    neutral: 'bg-soft text-muted-foreground',
    clay: 'bg-soft text-primary',
  }

  return (
    <div className={cn('flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-label', toneClass[state.tone], className)}>
      <Icon size={16} className="mt-px shrink-0" aria-hidden="true" />
      <p>
        <strong className="font-semibold">{state.label}.</strong> {state.detail}
      </p>
    </div>
  )
}
