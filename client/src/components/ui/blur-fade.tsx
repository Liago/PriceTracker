"use client"

import { useRef } from "react"
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type MotionProps,
  type UseInViewOptions,
  type Variants,
} from "motion/react"

/*
 * Magic UI BlurFade (magicui.design, MIT), installato come da
 * `shadcn add @magicui/blur-fade`. Adattamenti per questa app:
 *
 * - Durata predefinita 0.3 s (la guida grenade vuole 200-400 ms, una volta
 *   sola) e curva ease-out decisa invece di "easeOut".
 * - Con "riduci movimento" resta solo la dissolvenza: niente spostamento,
 *   niente blur.
 */

type MarginType = UseInViewOptions["margin"]

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode
  className?: string
  variant?: {
    hidden: { y: number }
    visible: { y: number }
  }
  duration?: number
  delay?: number
  offset?: number
  direction?: "up" | "down" | "left" | "right"
  inView?: boolean
  inViewMargin?: MarginType
  blur?: string
}

const getFilter = (v: Variants[string]) =>
  typeof v === "function" ? undefined : v.filter

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.3,
  delay = 0,
  offset = 6,
  direction = "down",
  inView = false,
  inViewMargin = "-50px",
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const ref = useRef(null)
  const reduceMotion = useReducedMotion()
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin })
  const isInView = !inView || inViewResult
  const axis = direction === "left" || direction === "right" ? "x" : "y"
  const defaultVariants: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : {
        hidden: {
          [axis]: direction === "right" || direction === "down" ? -offset : offset,
          opacity: 0,
          filter: `blur(${blur})`,
        },
        visible: {
          [axis]: 0,
          opacity: 1,
          filter: `blur(0px)`,
        },
      }
  const combinedVariants = variant ?? defaultVariants

  const hiddenFilter = getFilter(combinedVariants.hidden)
  const visibleFilter = getFilter(combinedVariants.visible)

  const shouldTransitionFilter =
    hiddenFilter != null &&
    visibleFilter != null &&
    hiddenFilter !== visibleFilter

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={combinedVariants}
        transition={{
          delay: 0.04 + delay,
          duration,
          ease: [0.23, 1, 0.32, 1],
          ...(shouldTransitionFilter ? { filter: { duration } } : {}),
        }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
