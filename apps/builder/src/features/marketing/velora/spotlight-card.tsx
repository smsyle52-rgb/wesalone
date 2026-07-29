"use client"

import { useRef } from "react"
import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> { children: React.ReactNode; radius?: number; color?: string }

/** Adapted from Velora UI, MIT licensed. */
export function SpotlightCard({ children, className, radius = 320, color = "rgba(34,211,238,.14)", ...props }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => { const element = ref.current; if (!element) return; const rect = element.getBoundingClientRect(); element.style.setProperty("--spot-x", `${event.clientX - rect.left}px`); element.style.setProperty("--spot-y", `${event.clientY - rect.top}px`) }
  return <div className={cn("group relative overflow-hidden rounded-2xl border bg-card", className)} data-slot="spotlight-card" onMouseMove={handleMouseMove} ref={ref} style={{ "--spot-radius": `${radius}px`, "--spot-color": color } as React.CSSProperties} {...props}><div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(var(--spot-radius) circle at var(--spot-x, 50%) var(--spot-y, 50%), var(--spot-color), transparent 65%)" }} /><div className="relative z-10">{children}</div></div>
}
