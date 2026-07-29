"use client"

import { motion, useReducedMotion } from "motion/react"
import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface BlurFadeProps { children: React.ReactNode; className?: string; delay?: number; duration?: number; direction?: "up" | "down" | "left" | "right" | "none"; offset?: number; once?: boolean }
const axis = { up: "y", down: "y", left: "x", right: "x" } as const
const sign = { up: 1, down: -1, left: 1, right: -1 } as const

/** Adapted from Velora UI, MIT licensed. */
export function BlurFade({ children, className, delay = 0, duration = 0.5, direction = "up", offset = 16, once = true }: BlurFadeProps) {
  const reducedMotion = useReducedMotion()
  const hidden = direction === "none" ? { opacity: 0, filter: "blur(6px)" } : { opacity: 0, filter: "blur(6px)", [axis[direction]]: sign[direction] * offset }
  return <motion.div className={cn(className)} data-slot="blur-fade" initial={hidden} transition={reducedMotion ? { duration: 0 } : { delay, duration, ease: [0.21, 0.47, 0.32, 0.98] }} viewport={{ once, margin: "0px 0px -10% 0px" }} whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, y: 0 }}>{children}</motion.div>
}
