import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const FIELD =
  'h-11 w-full rounded-[10px] border border-border bg-card px-3 text-body text-foreground ' +
  'placeholder:text-subtle transition-[border-color,box-shadow] duration-150 ease-out ' +
  'focus:border-clay focus:outline-none focus:ring-3 focus:ring-[color-mix(in_srgb,var(--clay)_22%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(FIELD, className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(FIELD, 'cursor-pointer appearance-none pr-9', className)} {...props} />
})

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-label font-medium text-muted-foreground', className)} {...props} />
}
