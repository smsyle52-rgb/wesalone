import type { ComponentProps } from "react"

import { cn } from "../lib/utils"
import { Spinner } from "./spinner"

function LoadingState({
  className,
  label = "جار التحميل...",
  ...props
}: ComponentProps<"div"> & { label?: string }) {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      data-slot="loading-state"
      className={cn("flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <Spinner aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export { LoadingState }
