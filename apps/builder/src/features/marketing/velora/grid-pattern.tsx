import { useId } from "react"
import type React from "react"
import { cn } from "@chatbotx.io/ui/lib/utils"

interface GridPatternProps extends React.SVGProps<SVGSVGElement> { width?: number; height?: number; x?: number; y?: number; squares?: Array<[number, number]>; strokeDasharray?: string }

/** Adapted from Velora UI, MIT licensed. */
export function GridPattern({ width = 40, height = 40, x = -1, y = -1, strokeDasharray = "0", squares, className, ...props }: GridPatternProps) {
  const id = useId()
  return <svg aria-hidden className={cn("pointer-events-none absolute inset-0 size-full fill-muted/40 stroke-border", className)} data-slot="grid-pattern" {...props}><defs><pattern height={height} id={id} patternUnits="userSpaceOnUse" width={width} x={x} y={y}><path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} /></pattern></defs><rect fill={`url(#${id})`} height="100%" strokeWidth={0} width="100%" />{squares && <svg className="overflow-visible" x={x} y={y}>{squares.map(([sx, sy]) => <rect height={height - 1} key={`${sx}-${sy}`} strokeWidth="0" width={width - 1} x={sx * width + 1} y={sy * height + 1} />)}</svg>}</svg>
}
