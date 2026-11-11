import { describe, expect, it } from "vitest"
import { describeAdReferral } from "../src/integration/handlers/automated-response/ad-context"

describe("describeAdReferral", () => {
  it("gives the agent the clicked ad's headline and text", () => {
    const note = describeAdReferral({
      adId: "120252443861460030",
      raw: {
        headline: "مركز خبراء الزراعة",
        body: "هل تعاني من ملوحة التربة؟\nبركان بلاس... خطوة نحو نبات أقوى",
      },
    })
    expect(note).toContain("AD CONTEXT")
    expect(note).toContain(
      "مركز خبراء الزراعة — هل تعاني من ملوحة التربة؟ بركان بلاس",
    )
  })

  it("falls back to the stored ad title", () => {
    expect(describeAdReferral({ adTitle: "فولكا" })).toContain("«فولكا»")
  })

  it("is empty for customers who did not come from an ad", () => {
    expect(describeAdReferral(null)).toBeNull()
    expect(describeAdReferral({ ref: "x", raw: {} })).toBeNull()
  })
})
