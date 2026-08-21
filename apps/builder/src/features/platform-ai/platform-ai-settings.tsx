"use client"

import type { PlatformAiCapabilities } from "@chatbotx.io/database/partials"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { SwitchField } from "@chatbotx.io/ui/components/form/switch-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chatbotx.io/ui/components/ui/card"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { Label } from "@chatbotx.io/ui/components/ui/label"
import { zodResolver } from "@hookform/resolvers/zod"
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { updatePlatformAiSettingsSchema } from "./schema"
import { updatePlatformAiSettingsAction } from "./update-platform-ai-settings.action"
import { validatePlatformAiSettingsAction } from "./validate-platform-ai-settings.action"

export type PlatformAiSettingsProps = {
  setting: {
    chatModel: string
    embeddingModel: string
    fallbackModel: string | null
    location: string
    capabilities: PlatformAiCapabilities
    enabled: boolean
  }
}

// Never renders projectId/credentials — the server action layer doesn't
// return them either (see validate-platform-ai-settings.action.ts).
export function PlatformAiSettings({ setting }: PlatformAiSettingsProps) {
  const t = useTranslations()
  const router = useRouter()

  const { form, handleSubmitWithAction } = useHookFormAction(
    updatePlatformAiSettingsAction,
    zodResolver(updatePlatformAiSettingsSchema),
    {
      actionProps: {
        onSuccess: () => {
          toast.success(
            t("messages.updatedSuccess", {
              feature: t("platformAiSettings.title"),
            }),
          )
          router.refresh()
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
      formProps: {
        defaultValues: {
          chatModel: setting.chatModel,
          fallbackModel: setting.fallbackModel ?? "",
          location: setting.location,
          capabilities: setting.capabilities,
          enabled: setting.enabled,
        },
      },
    },
  )

  const [validation, setValidation] = useState<{
    ok: boolean
    issues: string[]
  } | null>(null)

  const { execute: validate, isPending: isValidating } = useAction(
    validatePlatformAiSettingsAction,
    {
      onSuccess: ({ data }) => {
        if (data) {
          setValidation({ ok: data.ok, issues: data.issues })
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? t("platformAiSettings.validate.error"))
      },
    },
  )

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmitWithAction}>
        <Card>
          <CardHeader>
            <CardTitle>{t("platformAiSettings.title")}</CardTitle>
            <CardDescription>
              {t("platformAiSettings.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <div className="flex flex-col gap-1">
              <Label>{t("platformAiSettings.provider.label")}</Label>
              <p className="text-muted-foreground text-sm">
                {t("platformAiSettings.provider.value")}
              </p>
            </div>

            <SwitchField
              description={t("platformAiSettings.enabled.description")}
              label={t("platformAiSettings.enabled.label")}
              name="enabled"
            />

            <InputField
              label={t("platformAiSettings.chatModel.label")}
              name="chatModel"
              required
            />

            <InputField
              description={t("platformAiSettings.location.description")}
              label={t("platformAiSettings.location.label")}
              name="location"
              required
            />

            <InputField
              description={t("platformAiSettings.fallbackModel.description")}
              label={t("platformAiSettings.fallbackModel.label")}
              name="fallbackModel"
            />

            <div className="flex flex-col gap-1">
              <Label>{t("platformAiSettings.embeddingModel.label")}</Label>
              <p className="text-muted-foreground text-sm">
                {setting.embeddingModel}
                {" — "}
                {t("platformAiSettings.embeddingModel.description")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("platformAiSettings.capabilities.title")}</CardTitle>
            <CardDescription>
              {t("platformAiSettings.capabilities.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {CAPABILITY_FIELDS.map(({ key, providers }) => (
              <div className="space-y-3 rounded-lg border p-4" key={key}>
                <Label>
                  {t(`platformAiSettings.capabilities.items.${key}`)}
                </Label>
                <SelectField
                  label={t("platformAiSettings.capabilities.provider")}
                  name={`capabilities.${key}.provider`}
                  options={providers}
                  required
                />
                <InputField
                  label={t("platformAiSettings.capabilities.model")}
                  name={`capabilities.${key}.model`}
                  required
                />
                <InputField
                  label={t("platformAiSettings.capabilities.fallbackModel")}
                  name={`capabilities.${key}.fallbackModel`}
                />
                <InputField
                  label={t("platformAiSettings.capabilities.location")}
                  name={`capabilities.${key}.location`}
                />
                {key === "textToSpeech" && (
                  <InputField
                    label={t("platformAiSettings.capabilities.voice")}
                    name="capabilities.textToSpeech.voice"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            disabled={isValidating}
            onClick={() => validate()}
            type="button"
            variant="outline"
          >
            {isValidating && <Loader2Icon className="size-4 animate-spin" />}
            {t("platformAiSettings.validate.button")}
          </Button>

          <Button disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting && (
              <Loader2Icon className="size-4 animate-spin" />
            )}
            {t("actions.save")}
          </Button>
        </div>

        {validation && (
          <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            {validation.ok ? (
              <CheckCircle2Icon className="size-4 shrink-0 text-green-600" />
            ) : (
              <XCircleIcon className="size-4 shrink-0 text-destructive" />
            )}
            <span>
              {validation.ok
                ? t("platformAiSettings.validate.success")
                : validation.issues
                    .map((issue) => t(`platformAiSettings.validate.${issue}`))
                    .join(", ")}
            </span>
          </div>
        )}
      </form>
    </Form>
  )
}

const AZURE_OPENAI_OR_WORKSPACE_OPTIONS = [
  { label: "Azure OpenAI", value: "azureOpenAI" },
  { label: "Workspace", value: "workspace" },
]

const WORKSPACE_OPTIONS = [{ label: "Workspace", value: "workspace" }]

// Speech-to-text resolves through the platform provider: Azure OpenAI
// (OpenAI's own transcription model, served from Azure) with Vertex as the
// fallback that runs today. Offering only Workspace made the row
// unusable once per-workspace AI keys were retired.
const VOICE_INPUT_OPTIONS = [
  { label: "Azure OpenAI", value: "azureOpenAI" },
  { label: "Vertex (Google)", value: "vertex" },
  { label: "Workspace", value: "workspace" },
]

// getPlatformTextToSpeechConfig returns a config ONLY for `vertex`, so a
// page that could not offer it made text-to-speech impossible to configure.
const VOICE_OUTPUT_OPTIONS = [
  { label: "Vertex (Google)", value: "vertex" },
  { label: "Google Cloud", value: "googleCloud" },
  { label: "Workspace", value: "workspace" },
]

const DOCUMENT_PROVIDER_OPTIONS = [
  { label: "Local", value: "local" },
  { label: "Google Cloud", value: "googleCloud" },
]

const CAPABILITY_FIELDS = [
  { key: "vision", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
  { key: "embedding", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
  { key: "summarization", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
  { key: "extraction", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
  { key: "imageGeneration", providers: WORKSPACE_OPTIONS },
  { key: "imageEditing", providers: WORKSPACE_OPTIONS },
  { key: "speechToText", providers: VOICE_INPUT_OPTIONS },
  { key: "textToSpeech", providers: VOICE_OUTPUT_OPTIONS },
  { key: "webSearch", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
  { key: "documentParsing", providers: DOCUMENT_PROVIDER_OPTIONS },
  { key: "translation", providers: AZURE_OPENAI_OR_WORKSPACE_OPTIONS },
] as const
