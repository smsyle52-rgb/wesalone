"use client"

import { motion, useReducedMotion } from "motion/react"
import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface BorderBeamProps { className?: string; size?: number; duration?: number; delay?: number; reverse?: boolean; colorFrom?: string; colorTo?: string }

/** Adapted from Velora UI, MIT licensed. */
export function BorderBeam({ className, size = 64, duration = 6, delay = 0, reverse = false, colorFrom = "#22d3ee", colorTo = "#3b82f6" }: BorderBeamProps) {
  const reducedMotion = useReducedMotion()
  return <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)] motion-reduce:hidden" data-slot="border-beam"><motion.div animate={reducedMotion ? undefined : { offsetDistance: reverse ? "0%" : "100%" }} className={cn("absolute aspect-square bg-gradient-to-l from-(--beam-from) via-(--beam-to) to-transparent", className)} initial={{ offsetDistance: reverse ? "100%" : "0%" }} style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, "--beam-from": colorFrom, "--beam-to": colorTo } as React.CSSProperties} transition={{ repeat: Number.POSITIVE_INFINITY, ease: "linear", duration, delay: -delay }} /></div>
}
