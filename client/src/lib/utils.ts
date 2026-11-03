import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge deve conoscere le cinque dimensioni di testo del tema:
 * altrimenti scambia `text-label` per un colore e lo scarta quando accanto
 * c'è `text-good`, e le pill tornano a 16px.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['num', 'title', 'heading', 'body', 'label'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
