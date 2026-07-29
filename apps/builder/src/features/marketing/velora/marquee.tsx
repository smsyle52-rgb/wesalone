import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface MarqueeProps extends React.HTMLAttributes<HTMLDivElement> { reverse?: boolean; pauseOnHover?: boolean; vertical?: boolean; repeat?: number; fade?: boolean; children: React.ReactNode }

/** Adapted from Velora UI, MIT licensed. */
export function Marquee({ className, reverse = false, pauseOnHover = false, vertical = false, repeat = 4, fade = true, children, ...props }: MarqueeProps) {
  return <div {...props} className={cn("group flex gap-(--gap) overflow-hidden [--duration:40s] [--gap:1rem]", vertical ? "flex-col" : "flex-row", fade && (vertical ? "[mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]" : "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"), className)} data-slot="marquee">{Array.from({ length: repeat }).map((_, index) => <div aria-hidden={index > 0 || undefined} className={cn("flex shrink-0 justify-around gap-(--gap)", vertical ? "animate-marquee-vertical flex-col" : "animate-marquee flex-row", reverse && "[animation-direction:reverse]", pauseOnHover && "group-hover:[animation-play-state:paused]")} key={index}>{children}</div>)}</div>
}
