import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  intensity?: "subtle" | "medium" | "vivid"
}

const intensityClass = {
  subtle: "opacity-25 dark:opacity-20",
  medium: "opacity-40 dark:opacity-30",
  vivid: "opacity-60 dark:opacity-45",
}

/** Adapted from Velora UI, MIT licensed. */
export function AuroraBackground({ className, intensity = "medium", ...props }: AuroraBackgroundProps) {
  return <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", intensityClass[intensity], className)} data-slot="aurora-background" {...props}><div className="animate-aurora-1 absolute -top-1/4 left-[10%] size-[44rem] rounded-full bg-brand-from blur-[120px] will-change-transform" /><div className="animate-aurora-2 absolute top-[5%] right-[5%] size-[38rem] rounded-full bg-brand-via blur-[130px] will-change-transform" /><div className="animate-aurora-3 absolute -bottom-1/4 left-[35%] size-[40rem] rounded-full bg-brand-to blur-[140px] will-change-transform" /></div>
}
