"use client"

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react"

import { cn } from "@/lib/utils"

/*
 * Magic UI NumberTicker (magicui.design, MIT), installato come da
 * `shadcn add @magicui/number-ticker`. Adattamenti per questa app:
 *
 * - `useGrouping` (default false): i prezzi si mostrano come sono salvati,
 *   379.99 e non 379,99 o 1,379.99. Nessun numero cambia aspetto.
 * - Con "riduci movimento" il numero compare già fermo sul valore finale.
 * - Il testo iniziale è già il valore finale per screen reader e per chi
 *   arriva senza JavaScript; il conteggio parte da `startValue` solo quando
 *   l'elemento entra in vista.
 * - Colori ereditati dal contesto invece di nero/bianco fissi.
 */

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
  useGrouping?: boolean
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  useGrouping = false,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  })
  const isInView = useInView(ref, { once: true, margin: "0px" })

  const format = (n: number) =>
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
      useGrouping,
    }).format(Number(n.toFixed(decimalPlaces)))

  useEffect(() => {
    if (reduceMotion) {
      if (ref.current) ref.current.textContent = format(value)
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    if (isInView) {
      timer = setTimeout(() => {
        motionValue.set(direction === "down" ? startValue : value)
      }, delay * 1000)
    }

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionValue, isInView, delay, value, direction, startValue, reduceMotion])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current && !reduceMotion) {
          ref.current.textContent = format(latest)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [springValue, decimalPlaces, useGrouping, reduceMotion]
  )

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums", className)}
      aria-label={format(value)}
      {...props}
    >
      {format(reduceMotion ? value : direction === "down" ? value : startValue)}
    </span>
  )
}
