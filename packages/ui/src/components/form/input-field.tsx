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
      {(field) => <Input {...props} {...field} value={field.value ?? ""} />}
    </FormFieldWrapper>
  )
}
