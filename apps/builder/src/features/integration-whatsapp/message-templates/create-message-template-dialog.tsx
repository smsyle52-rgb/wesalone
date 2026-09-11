"use client"

import { whatsappTemplateCategories } from "@chatbotx.io/database/partials"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  type DialogChangeEventDetails,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MessageSquareIcon,
  PhoneIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useMemo, useState } from "react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { TextWithVariablesField } from "@/features/integration-messenger/message-templates/components/text-with-variables-field"
import { createWhatsappMessageTemplateAction } from "./actions/create-message-template"
import {
  type CreateWhatsappMessageTemplateRequest,
  createWhatsappMessageTemplateRequest,
} from "./schema/create-message-template"
import { languageOptions } from "./type"

type ButtonType =
  CreateWhatsappMessageTemplateRequest["buttons"][number]["type"]

const buttonTypes: {
  type: ButtonType
  labelKey: string
  icon: typeof MessageSquareIcon
}[] = [
  {
    type: "QUICK_REPLY",
    labelKey: "whatsapp.messageTemplate.create.quickReply",
    icon: MessageSquareIcon,
  },
  {
    type: "URL",
    labelKey: "messenger.messageTemplate.create.visitWebsite",
    icon: ExternalLinkIcon,
  },
  {
    type: "PHONE_NUMBER",
    labelKey: "messenger.messageTemplate.create.callPhoneNumber",
    icon: PhoneIcon,
  },
]

const buildDefaultValues = (
  language: string,
): CreateWhatsappMessageTemplateRequest => ({
  name: "",
  language,
  category: whatsappTemplateCategories.enum.MARKETING,
  headerType: "none",
  headerText: "",
  headerVariables: [],
  body: "",
  bodyVariables: [],
  footer: "",
  buttons: [],
})

function TemplateButtonFields({
  index,
  onRemove,
}: {
  index: number
  onRemove: () => void
}) {
  const t = useTranslations()
  const form = useFormContext<CreateWhatsappMessageTemplateRequest>()
  const type = useWatch({
    control: form.control,
    name: `buttons.${index}.type`,
  })
  const buttonType = buttonTypes.find((item) => item.type === type)
  const Icon = buttonType?.icon ?? MessageSquareIcon

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <div className="truncate font-medium text-sm">
            {buttonType ? t(buttonType.labelKey) : null}
          </div>
        </div>
        <Button
          aria-label={t("actions.delete")}
          className="shrink-0"
          onClick={onRemove}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      <InputField
        label={t("messenger.messageTemplate.create.buttonText")}
        name={`buttons.${index}.title`}
        required
      />

      {type === "URL" && (
        <InputField
          label={t("fields.url.label")}
          name={`buttons.${index}.url`}
          placeholder="https://"
          required
        />
      )}

      {type === "PHONE_NUMBER" && (
        <InputField
          label={t("fields.phoneNumber.label")}
          name={`buttons.${index}.phoneNumber`}
          placeholder="+967771234567"
          required
        />
      )}
    </div>
  )
}

export function CreateWhatsappMessageTemplateDialog({
  workspaceId,
  integrationWhatsappId,
}: {
  workspaceId: string
  integrationWhatsappId: string
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const defaultValues = useMemo(
    () => buildDefaultValues(locale.startsWith("ar") ? "ar" : "en"),
    [locale],
  )

  const boundAction = useMemo(
    () =>
      createWhatsappMessageTemplateAction.bind(
        null,
        workspaceId,
        integrationWhatsappId,
      ),
    [workspaceId, integrationWhatsappId],
  )

  const { form, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      boundAction,
      zodResolver(createWhatsappMessageTemplateRequest),
      {
        actionProps: {
          onSuccess: ({ data }) => {
            if (data?.status === "REJECTED") {
              toast.error(t("whatsapp.messageTemplate.create.rejected"))
            } else {
              toast.success(t("whatsapp.messageTemplate.create.submitted"))
              setOpen(false)
              resetFormAndAction()
            }
            router.refresh()
          },
          onError: ({ error }) => {
            if (error.serverError) {
              toast.error(error.serverError)
            }
          },
        },
        formProps: { mode: "onChange", defaultValues },
        errorMapProps: {},
      },
    )

  const headerType = useWatch({ control: form.control, name: "headerType" })
  const {
    fields: buttons,
    append: appendButton,
    remove: removeButton,
  } = useFieldArray({ control: form.control, name: "buttons" })

  const handleOpenChange = useCallback(
    (isOpen: boolean, eventDetails: DialogChangeEventDetails) => {
      if (!isOpen && eventDetails.reason === "outside-press") {
        eventDetails.cancel()
        return
      }
      setOpen(isOpen)
      resetFormAndAction()
      form.reset(defaultValues)
    },
    [defaultValues, form, resetFormAndAction],
  )

  const categoryOptions = useMemo(
    () => [
      {
        label: t("whatsapp.category.marketing.label"),
        value: whatsappTemplateCategories.enum.MARKETING,
      },
      {
        label: t("whatsapp.category.utility.label"),
        value: whatsappTemplateCategories.enum.UTILITY,
      },
    ],
    [t],
  )

  const headerOptions = useMemo(
    () => [
      { label: t("messenger.messageTemplate.create.none"), value: "none" },
      { label: t("messenger.messageTemplate.create.text"), value: "text" },
    ],
    [t],
  )

  const addButton = (type: ButtonType) => {
    if (type === "URL") {
      appendButton({ type, title: "", url: "" })
      return
    }
    if (type === "PHONE_NUMBER") {
      appendButton({ type, title: "", phoneNumber: "" })
      return
    }
    appendButton({ type, title: "" })
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={
          <Button size="sm">
            <PlusIcon className="size-4" />
            {t("whatsapp.messageTemplate.create.trigger")}
          </Button>
        }
      />
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="mb-2">
          <DialogTitle>
            {t("actions.createFeature", {
              feature: t("fields.messageTemplate.label"),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("whatsapp.messageTemplate.create.reviewNote")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-6" onSubmit={handleSubmitWithAction}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <InputField
                  description={t("whatsapp.messageTemplate.create.nameHint")}
                  label={t("fields.name.label")}
                  name="name"
                  placeholder="offer_sep"
                  required
                />
              </div>
              <SelectField
                label={t("fields.language.label")}
                name="language"
                options={languageOptions}
                required
              />
              <SelectField
                label={t("fields.category.label")}
                name="category"
                options={categoryOptions}
                required
              />
            </div>

            <div className="space-y-4">
              <SelectField
                label={t("messenger.messageTemplate.create.headerType")}
                name="headerType"
                options={headerOptions}
                required
              />
              {headerType === "text" && (
                <TextWithVariablesField
                  label={t("messenger.messageTemplate.create.header")}
                  maxVariables={1}
                  name="headerText"
                  variablesName="headerVariables"
                />
              )}
            </div>

            <TextWithVariablesField
              label={t("messenger.messageTemplate.create.body")}
              maxVariables={9}
              name="body"
              variablesLayout="stack"
              variablesName="bodyVariables"
            />

            <InputField
              label={t("whatsapp.messageTemplate.create.footer")}
              name="footer"
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">
                  {t("messenger.messageTemplate.create.buttons")}
                </div>
                {buttons.length < 3 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button size="sm" type="button" variant="secondary">
                          <PlusIcon className="size-4" />
                          {t("messenger.messageTemplate.create.addButton")}
                          <ChevronDownIcon className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {buttonTypes.map((buttonType) => (
                        <DropdownMenuItem
                          key={buttonType.type}
                          onClick={() => addButton(buttonType.type)}
                        >
                          <buttonType.icon className="size-4" />
                          {t(buttonType.labelKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {buttons.map((button, index) => (
                <TemplateButtonFields
                  index={index}
                  key={button.id}
                  onRemove={() => removeButton(index)}
                />
              ))}
            </div>

            <DialogFooter className="gap-2 sm:space-x-0">
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    {t("actions.cancel")}
                  </Button>
                }
              />
              <Button
                disabled={
                  !form.formState.isValid || form.formState.isSubmitting
                }
                type="submit"
              >
                {form.formState.isSubmitting && (
                  <Loader2Icon className="animate-spin" />
                )}
                {t("actions.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
