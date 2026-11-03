import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** La card dello style kit: bordo da 1px, raggio 14px, ombra morbida solo nel chiaro. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[14px] border border-border bg-card text-card-foreground shadow-card', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center justify-between gap-3 px-5 pt-5', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('font-serif text-heading', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}
