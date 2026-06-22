import { DirectionProvider as BaseDirectionProvider } from "@base-ui/react/direction-provider"
import type { ComponentProps } from "react"

function DirectionProvider({
  direction = "rtl",
  ...props
}: ComponentProps<typeof BaseDirectionProvider>) {
  return <BaseDirectionProvider direction={direction} {...props} />
}

export { DirectionProvider }
