import type { CreateWhatsappMessageTemplateRequest } from "../schema/create-message-template"

export type WhatsappTemplateButtonComponent =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }

export type WhatsappTemplateComponent =
  | {
      type: "HEADER"
      format: "TEXT"
      text: string
      example?: { header_text: string[] }
    }
  | {
      type: "BODY"
      text: string
      example?: { body_text: string[][] }
    }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: WhatsappTemplateButtonComponent[] }

type TemplateButton = CreateWhatsappMessageTemplateRequest["buttons"][number]

function buildButton(button: TemplateButton): WhatsappTemplateButtonComponent {
  if (button.type === "URL") {
    return { type: "URL", text: button.title, url: button.url }
  }
  if (button.type === "PHONE_NUMBER") {
    return {
      type: "PHONE_NUMBER",
      text: button.title,
      phone_number: button.phoneNumber,
    }
  }
  return { type: "QUICK_REPLY", text: button.title }
}

/**
 * Map the create-template form to the `components` array Meta's
 * `/{waba-id}/message_templates` endpoint expects. Variable examples are
 * required by Meta whenever the text carries `{{n}}` placeholders; the body
 * example is double-wrapped (`[[...]]`), the header one is not.
 */
export function buildWhatsappMessageTemplateComponents(
  input: CreateWhatsappMessageTemplateRequest,
): WhatsappTemplateComponent[] {
  const components: WhatsappTemplateComponent[] = []

  if (input.headerType === "text") {
    const headerExample = input.headerVariables.map((v) => v.example)
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: input.headerText,
      ...(headerExample.length > 0
        ? { example: { header_text: headerExample } }
        : {}),
    })
  }

  const bodyExample = input.bodyVariables.map((v) => v.example)
  components.push({
    type: "BODY",
    text: input.body,
    ...(bodyExample.length > 0
      ? { example: { body_text: [bodyExample] } }
      : {}),
  })

  if (input.footer.length > 0) {
    components.push({ type: "FOOTER", text: input.footer })
  }

  if (input.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons.map(buildButton),
    })
  }

  return components
}
