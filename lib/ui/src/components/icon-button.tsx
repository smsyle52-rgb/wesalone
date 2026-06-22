import type { ComponentProps } from "react"

import { Button } from "./button"

type IconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "aria-label"> & {
  "aria-label": string
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg"
}

function IconButton({ size = "icon", ...props }: IconButtonProps) {
  return <Button data-slot="icon-button" size={size} {...props} />
}

export { IconButton, type IconButtonProps }
