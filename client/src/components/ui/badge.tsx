import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pill di stato. Verde, rosso e ambra significano solo buono, cattivo e da
 * tenere d'occhio; `neutral` è per le etichette senza giudizio (il negozio).
 */
export type BadgeTone = 'good' | 'bad' | 'watch' | 'neutral' | 'clay'

const TONES: Record<BadgeTone, string> = {
  good: 'bg-good-bg text-good',
  bad: 'bg-bad-bg text-bad',
  watch: 'bg-watch-bg text-watch',
  neutral: 'bg-soft text-muted-foreground border border-border',
  clay: 'bg-[color-mix(in_srgb,var(--clay)_14%,transparent)] text-primary dark:text-clay',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-label font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
