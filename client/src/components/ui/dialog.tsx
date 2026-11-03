import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { Button } from './button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** Larghezza massima del pannello. */
  size?: 'md' | 'lg'
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const

/**
 * Dialog modale.
 *
 * Entra con scale 0.96 + opacità in 200 ms ease-out ed esce più in fretta
 * (140 ms): lento dove l'utente legge, rapido dove il sistema risponde. I
 * modali restano centrati, quindi transform-origin resta al centro. Esc chiude,
 * il focus va al pannello e torna al bottone che l'ha aperto.
 */
export function Dialog({ open, onClose, title, children, size = 'md' }: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Il primo campo prende il focus; altrimenti il pannello.
    const frame = requestAnimationFrame(() => {
      const field = panelRef.current?.querySelector<HTMLElement>('input, select, textarea')
      ;(field ?? panelRef.current)?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE_OUT } }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`relative w-full ${size === 'lg' ? 'max-w-lg' : 'max-w-md'} rounded-[14px] border border-border bg-card text-card-foreground shadow-[0_24px_60px_rgba(0,0,0,0.18)] outline-none`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: EASE_OUT } }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <h2 id={titleId} className="flex items-center gap-2 font-serif text-heading">
                {title}
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Chiudi">
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
