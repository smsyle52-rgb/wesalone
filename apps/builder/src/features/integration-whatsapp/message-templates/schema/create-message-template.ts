import { whatsappTemplateCategories } from "@chatbotx.io/database/partials"
import { z } from "zod"
import {
  addPlaceholderIssues,
  extractPlaceholders,
} from "@/features/integration-messenger/message-templates/schema/mutation"
import { languageOptions } from "../type"

const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/
const SUPPORTED_PLACEHOLDER_PATTERN = /^{{[1-9]}}$/
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/
// Same shape the flow/broadcast button schema already accepts.
const PHONE_NUMBER_PATTERN = /^\+?[1-9][0-9]{7,18}$/
const LEADING_VARIABLE_PATTERN = /^\s*{{\d+}}/
const TRAILING_VARIABLE_PATTERN = /{{\d+}}\s*$/
const ADJACENT_VARIABLES_PATTERN = /{{\d+}}\s*{{\d+}}/

// Meta limits for a WhatsApp message template.
const BUTTON_TEXT_MAX = 25
const MAX_URL_BUTTONS = 2
const MAX_PHONE_BUTTONS = 1

const templateVariableSchema = z.object({
  key: z.string().regex(SUPPORTED_PLACEHOLDER_PATTERN),
  example: z.string().trim().min(1),
})

const buttonTitleSchema = z.string().trim().min(1).max(BUTTON_TEXT_MAX)

// URL buttons are static for now: Meta's variable URL buttons need a sample
// URL whose exact shape we have not verified against a live approval.
const templateButtonSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("QUICK_REPLY"),
    title: buttonTitleSchema,
  }),
  z.object({
    type: z.literal("URL"),
    title: buttonTitleSchema,
    url: z.string().trim().regex(HTTP_URL_PATTERN, {
      message: "Enter a full link starting with https://",
    }),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    title: buttonTitleSchema,
    phoneNumber: z.string().trim().regex(PHONE_NUMBER_PATTERN, {
      message: "Enter the number with its country code, e.g. +967771234567",
    }),
  }),
])

export const createWhatsappMessageTemplateRequest = z
  .object({
    name: z.string().trim().min(1).max(512).regex(TEMPLATE_NAME_PATTERN, {
      message: "Use lowercase English letters, numbers and _ only",
    }),
    language: z.enum(
      languageOptions.map((option) => option.value) as [string, ...string[]],
    ),
    category: whatsappTemplateCategories,
    headerType: z.enum(["none", "text"]),
    headerText: z.string().trim().max(60).default(""),
    headerVariables: z.array(templateVariableSchema).max(1).default([]),
    body: z.string().trim().min(1).max(1024),
    bodyVariables: z.array(templateVariableSchema).max(9).default([]),
    footer: z.string().trim().max(60).default(""),
    buttons: z.array(templateButtonSchema).max(3).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.headerType === "text") {
      if (value.headerText.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Header text is required",
          path: ["headerText"],
        })
      }
      addPlaceholderIssues({
        ctx,
        path: ["headerVariables"],
        text: value.headerText,
        maxVariables: 1,
        variables: value.headerVariables,
      })
    }

    addPlaceholderIssues({
      ctx,
      path: ["bodyVariables"],
      text: value.body,
      maxVariables: 9,
      variables: value.bodyVariables,
    })

    // Meta rejects these outright, so catch them before a review round-trip.
    if (
      LEADING_VARIABLE_PATTERN.test(value.body) ||
      TRAILING_VARIABLE_PATTERN.test(value.body)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A variable can't be at the start or end of the message",
        path: ["body"],
      })
    }
    if (ADJACENT_VARIABLES_PATTERN.test(value.body)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Two variables can't be next to each other",
        path: ["body"],
      })
    }

    if (extractPlaceholders(value.footer).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The footer can't contain variables",
        path: ["footer"],
      })
    }

    const urlButtons = value.buttons.filter((button) => button.type === "URL")
    if (urlButtons.length > MAX_URL_BUTTONS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At most ${MAX_URL_BUTTONS} link buttons`,
        path: ["buttons"],
      })
    }
    const phoneButtons = value.buttons.filter(
      (button) => button.type === "PHONE_NUMBER",
    )
    if (phoneButtons.length > MAX_PHONE_BUTTONS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At most ${MAX_PHONE_BUTTONS} call button`,
        path: ["buttons"],
      })
    }
  })

export type CreateWhatsappMessageTemplateRequest = z.infer<
  typeof createWhatsappMessageTemplateRequest
>
