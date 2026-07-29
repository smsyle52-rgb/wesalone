import { cn } from "@chatbotx.io/ui/lib/utils"
import type { ComponentProps, ReactNode } from "react"
import type { FieldPath, FieldValues } from "react-hook-form"
import { Input } from "../ui/input"
import { FormFieldWrapper } from "./field-wrapper"

type InputFieldProps<T extends FieldValues> = ComponentProps<"input"> & {
  name: FieldPath<T>
  label?: string
  description?: string
  descriptionType?: "inline" | "tooltip"
  formItemClassName?: string
  /**
   * Optional leading glyph rendered inside the field. Purely decorative, so it
   * is hidden from assistive tech and does not swallow clicks — the label still
   * carries the meaning.
   */
  icon?: ReactNode
}

export function InputField<T extends FieldValues>({
  name,
  label,
  required,
  description,
  descriptionType = "inline",
  formItemClassName,
  icon,
  className,
  ...props
}: InputFieldProps<T>) {
  return (
    <FormFieldWrapper
      description={description}
      descriptionType={descriptionType}
      formItemClassName={formItemClassName}
      label={label}
      name={name}
      required={required}
    >
      {(field) =>
        icon ? (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-muted-foreground"
            >
              {icon}
            </span>
            <Input {...props} {...field} className={cn("ps-10", className)} />
          </div>
        ) : (
          <Input {...props} {...field} className={className} />
        )
      }
    </FormFieldWrapper>
  )
}
