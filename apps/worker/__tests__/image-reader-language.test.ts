import type { ImageReaderInput } from "@chatbotx.io/ai/server"
import type { AttachmentModel } from "@chatbotx.io/database/types"
import { describe, expect, test } from "vitest"
import {
  buildVisionPrompt,
  formatToolOutput,
} from "../src/integration/handlers/automated-response/system-tools/image-reader"

const attachment = {
  name: "catalog-item.jpg",
} as AttachmentModel

const input = {
  query: "",
} as ImageReaderInput

describe("image reader language", () => {
  test("uses Arabic instructions and tool output for Arabic inboxes", () => {
    const prompt = buildVisionPrompt({
      attachment,
      fileOnlyTrigger: true,
      input,
      language: "ar",
    })
    const output = formatToolOutput({
      analysis: "تظهر حقيبة باللون الأزرق.",
      attachment,
      fileOnlyTrigger: true,
      language: "ar-SA",
    })

    expect(prompt).toContain("أجب بالعربية فقط")
    expect(prompt).toContain("حلّل الصورة المرفقة")
    expect(prompt).not.toContain("Analyze the uploaded image")
    expect(output).toContain("الصورة: catalog-item.jpg")
    expect(output).toContain("التحليل: تظهر حقيبة باللون الأزرق.")
    expect(output).toContain("متابعة:")
  })

  test("retains English as the fallback language", () => {
    const prompt = buildVisionPrompt({
      attachment,
      fileOnlyTrigger: false,
      input,
      language: "en",
    })

    expect(prompt).toContain("Analyze the uploaded image")
    expect(prompt).not.toContain("أجب بالعربية فقط")
  })
})
