import type { ComponentProps, ReactNode } from "react"
import { CircleAlertIcon } from "lucide-react"

import { cn } from "../lib/utils"

function ErrorState({
  className,
  title = "تعذر إكمال الطلب",
  description,
  action,
  ...props
}: ComponentProps<"section"> & {
  title?: string
  description?: string
  action?: ReactNode
}) {
  return (
    <section
      role="alert"
      data-slot="error-state"
      className={cn("flex min-h-28 flex-col items-center justify-center gap-2 text-center", className)}
      {...props}
    >
      <CircleAlertIcon aria-hidden="true" className="size-5 text-destructive" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </section>
  )
}

export { ErrorState }
