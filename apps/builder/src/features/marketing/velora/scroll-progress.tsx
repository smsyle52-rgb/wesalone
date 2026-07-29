"use client"

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react"
import { cn } from "@chatbotx.io/ui/lib/utils"

/** Adapted from Velora UI, MIT licensed. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 32, restDelta: 0.001 })
  const reducedMotion = useReducedMotion()
  return <motion.div aria-hidden className={cn("fixed inset-x-0 top-0 z-[60] h-0.75 origin-right bg-gradient-to-l from-cyan-300 via-sky-400 to-blue-600", className)} data-slot="scroll-progress" style={{ scaleX: reducedMotion ? scrollYProgress : scaleX }} />
}
