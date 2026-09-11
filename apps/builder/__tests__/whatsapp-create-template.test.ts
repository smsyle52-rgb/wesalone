// @vitest-environment node
import { describe, expect, test } from "vitest"
import { buildWhatsappMessageTemplateComponents } from "@/features/integration-whatsapp/message-templates/lib/build-template-components"
import {
  type CreateWhatsappMessageTemplateRequest,
  createWhatsappMessageTemplateRequest,
} from "@/features/integration-whatsapp/message-templates/schema/create-message-template"

const base: CreateWhatsappMessageTemplateRequest = {
  name: "offer_sep",
  language: "ar",
  category: "MARKETING",
  headerType: "none",
  headerText: "",
  headerVariables: [],
  body: "السلام عليكم يا {{1}}، وصلت عروض جديدة",
  bodyVariables: [{ key: "{{1}}", example: "أحمد" }],
  footer: "",
  buttons: [],
}

const issuesFor = (input: Record<string, unknown>) => {
  const result = createWhatsappMessageTemplateRequest.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe("buildWhatsappMessageTemplateComponents", () => {
  test("body only, with the double-wrapped example Meta requires", () => {
    expect(buildWhatsappMessageTemplateComponents(base)).toEqual([
      {
        type: "BODY",
        text: base.body,
        example: { body_text: [["أحمد"]] },
      },
    ])
  })

  test("omits the example when the body has no variables", () => {
    expect(
      buildWhatsappMessageTemplateComponents({
        ...base,
        body: "السلام عليكم",
        bodyVariables: [],
      }),
    ).toEqual([{ type: "BODY", text: "السلام عليكم" }])
  })

  test("text header, footer and every button type in Meta's shape", () => {
    expect(
      buildWhatsappMessageTemplateComponents({
        ...base,
        headerType: "text",
        headerText: "عرض {{1}}",
        headerVariables: [{ key: "{{1}}", example: "سبتمبر" }],
        footer: "وصال ون",
        buttons: [
          { type: "QUICK_REPLY", title: "مهتم" },
          { type: "URL", title: "المتجر", url: "https://wesal.one" },
          {
            type: "PHONE_NUMBER",
            title: "اتصل بنا",
            phoneNumber: "+967771234567",
          },
        ],
      }),
    ).toEqual([
      {
        type: "HEADER",
        format: "TEXT",
        text: "عرض {{1}}",
        example: { header_text: ["سبتمبر"] },
      },
      { type: "BODY", text: base.body, example: { body_text: [["أحمد"]] } },
      { type: "FOOTER", text: "وصال ون" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "مهتم" },
          { type: "URL", text: "المتجر", url: "https://wesal.one" },
          {
            type: "PHONE_NUMBER",
            text: "اتصل بنا",
            phone_number: "+967771234567",
          },
        ],
      },
    ])
  })
})

describe("createWhatsappMessageTemplateRequest", () => {
  test("accepts a valid marketing template", () => {
    expect(issuesFor(base)).toEqual([])
  })

  test("rejects a name Meta would refuse", () => {
    expect(issuesFor({ ...base, name: "عرض سبتمبر" })).toContain(
      "Use lowercase English letters, numbers and _ only",
    )
    expect(issuesFor({ ...base, name: "Offer-Sep" })).toContain(
      "Use lowercase English letters, numbers and _ only",
    )
  })

  test.each([
    ["{{1}} السلام عليكم", "at the start"],
    ["السلام عليكم {{1}}", "at the end"],
  ])("rejects a variable %s (%s)", (body) => {
    expect(
      issuesFor({
        ...base,
        body,
        bodyVariables: [{ key: "{{1}}", example: "أحمد" }],
      }),
    ).toContain("A variable can't be at the start or end of the message")
  })

  test("rejects two adjacent variables", () => {
    expect(
      issuesFor({
        ...base,
        body: "مرحبا {{1}} {{2}} عندنا عرض",
        bodyVariables: [
          { key: "{{1}}", example: "أحمد" },
          { key: "{{2}}", example: "علي" },
        ],
      }),
    ).toContain("Two variables can't be next to each other")
  })

  test("requires an example for every body variable", () => {
    expect(issuesFor({ ...base, bodyVariables: [] })).toContain(
      "Variable examples must match the template text",
    )
  })

  test("requires header text when a text header is chosen", () => {
    expect(issuesFor({ ...base, headerType: "text" })).toContain(
      "Header text is required",
    )
  })

  test("rejects variables in the footer", () => {
    expect(issuesFor({ ...base, footer: "شكرا {{1}}" })).toContain(
      "The footer can't contain variables",
    )
  })

  test("validates button link and phone number", () => {
    expect(
      issuesFor({
        ...base,
        buttons: [{ type: "URL", title: "المتجر", url: "wesal.one" }],
      }),
    ).toContain("Enter a full link starting with https://")
    expect(
      issuesFor({
        ...base,
        buttons: [
          { type: "PHONE_NUMBER", title: "اتصل", phoneNumber: "0771234567" },
        ],
      }),
    ).toContain("Enter the number with its country code, e.g. +967771234567")
  })

  test("caps buttons at three and call buttons at one", () => {
    const quick = { type: "QUICK_REPLY", title: "نعم" }
    expect(
      issuesFor({ ...base, buttons: [quick, quick, quick, quick] }),
    ).not.toEqual([])
    const call = {
      type: "PHONE_NUMBER",
      title: "اتصل",
      phoneNumber: "+967771234567",
    }
    expect(issuesFor({ ...base, buttons: [call, call] })).toContain(
      "At most 1 call button",
    )
  })

  test("button text over Meta's 25 characters is refused", () => {
    expect(
      issuesFor({
        ...base,
        buttons: [{ type: "QUICK_REPLY", title: "ا".repeat(26) }],
      }),
    ).not.toEqual([])
  })
})
