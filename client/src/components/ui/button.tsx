import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Bottone in stile shadcn/ui con lo style kit grenade.
 *
 * - `main`: l'unica azione principale della schermata, in clay.
 * - `outline`: le azioni secondarie, bordo sottile su card.
 * - `ghost`: icone e azioni di contorno.
 * - `danger`: le azioni distruttive, solo dentro una conferma.
 *
 * Tutti scalano a 0.97 alla pressione (Emil Kowalski: "i bottoni devono
 * sembrare responsivi") e animano solo transform e colori, mai `all`.
 */
type Variant = 'main' | 'outline' | 'ghost' | 'danger'
type Size = 'md' | 'sm' | 'icon' | 'icon-sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANTS: Record<Variant, string> = {
  main: 'bg-primary text-primary-foreground border-0 hover:brightness-110',
  outline: 'bg-card text-foreground border border-border hover:bg-soft',
  ghost: 'bg-transparent text-muted-foreground border-0 hover:text-foreground hover:bg-soft',
  danger: 'bg-bad text-white border-0 hover:brightness-110 dark:text-black',
}

const SIZES: Record<Size, string> = {
  md: 'h-11 px-4 text-body gap-2',
  sm: 'h-9 px-3 text-label gap-1.5',
  icon: 'h-10 w-10 justify-center',
  'icon-sm': 'h-8 w-8 justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'pressable inline-flex shrink-0 cursor-pointer select-none items-center rounded-[10px] font-medium whitespace-nowrap',
        'transition-[transform,background-color,color,filter] duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
})
